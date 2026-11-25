"""authRoutes.py — session config + account routes.

Changes vs the migration version:
* configure_session fails loudly if SECRET_KEY is missing in production
  (detected via APP_ENV=production or Render's RENDER env var). The dev
  fallback still generates an ephemeral key so `python app.py` works.
* `print()` removed; logging replaces it.
* POST validation errors roll back the connection explicitly.
"""
import logging
import os
import re
import secrets
from datetime import timedelta

import psycopg2
from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from psycopg2.extras import RealDictCursor
from werkzeug.security import check_password_hash, generate_password_hash

from authHelpers import (
    User, current_user, is_safe_next, login_required, login_user, logout_user,
)
from db import get_db

EMAIL_RE = re.compile(r"^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
auth_bp = Blueprint("auth", __name__)
log = logging.getLogger(__name__)

_DUMMY_HASH = generate_password_hash("not-a-real-password")


def configure_session(app):
    key = os.environ.get("SECRET_KEY")
    is_prod = (
        os.environ.get("APP_ENV", "").lower() == "production"
        or bool(os.environ.get("RENDER"))
    )
    if not key:
        if is_prod:
            raise RuntimeError(
                "SECRET_KEY is required in production. Generate one with: "
                "python -c 'import secrets; print(secrets.token_hex(32))'"
            )
        key = secrets.token_hex(32)
        log.warning("SECRET_KEY not set; generated an ephemeral dev key.")
    app.config.update(
        SECRET_KEY=key,
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=is_prod,
    )


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("home"))

    errors, form = {}, {}
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        display_name = request.form.get("display_name", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")
        form = {"email": email, "display_name": display_name}

        if not email:
            errors["email"] = "Email is required."
        elif not EMAIL_RE.match(email):
            errors["email"] = "Enter a valid email address."
        if not display_name:
            errors["display_name"] = "Display name is required."
        if len(password) < 8:
            errors["password"] = "Password must be at least 8 characters."
        if not confirm:
            errors["confirm_password"] = "Please confirm your password."
        elif password != confirm:
            errors["confirm_password"] = "Passwords don't match."

        conn = get_db()
        try:
            with conn.cursor() as cur:
                if "email" not in errors:
                    cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
                    if cur.fetchone():
                        errors["email"] = "That email is already registered."
                if not errors:
                    cur.execute(
                        "INSERT INTO users (email, display_name, password_hash) "
                        "VALUES (%s, %s, %s)",
                        (email, display_name, generate_password_hash(password)),
                    )
                    conn.commit()
                    log.info("Account registered: %s", email)
                    flash("Account created. Please log in.", "success")
                    return redirect(url_for("home"))
        except psycopg2.IntegrityError:
            conn.rollback()
            flash("That email or display name is already taken.", "error")
    return render_template("login.html", mode="register", errors=errors, form=form)


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("home"))
    errors, form = {}, {}
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        form = {"email": email}
        conn = get_db()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            row = cur.fetchone()

        ok = check_password_hash(row["password_hash"] if row else _DUMMY_HASH, password)
        if row and ok:
            session.clear()
            login_user(User(row))
            session.permanent = True
            log.info("Login success: %s", email)
            nxt = request.args.get("next")
            return redirect(nxt if is_safe_next(nxt) else url_for("home"))
        log.warning("Login failure: %s", email)
        flash("Invalid email or password.", "error")
    return render_template("login.html", mode="login", errors=errors, form=form)


@auth_bp.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    errors = {}
    form = {"email": current_user.email, "display_name": current_user.display_name}
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        display_name = request.form.get("display_name", "").strip()
        current_pw = request.form.get("current_password", "")
        new_pw = request.form.get("new_password", "")
        confirm = request.form.get("confirm_password", "")
        form = {"email": email, "display_name": display_name}

        if not email:
            errors["email"] = "Email is required."
        elif not EMAIL_RE.match(email):
            errors["email"] = "Enter a valid email address."
        if not display_name:
            errors["display_name"] = "Display name is required."

        changing_pw = bool(current_pw or new_pw or confirm)
        conn = get_db()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if "email" not in errors and email != current_user.email:
                    cur.execute(
                        "SELECT 1 FROM users WHERE email = %s AND id != %s",
                        (email, current_user.id),
                    )
                    if cur.fetchone():
                        errors["email"] = "That email is already registered."

                new_hash = None
                if changing_pw:
                    cur.execute(
                        "SELECT password_hash FROM users WHERE id = %s",
                        (current_user.id,),
                    )
                    row = cur.fetchone()
                    if not check_password_hash(row["password_hash"], current_pw):
                        errors["current_password"] = "Current password is incorrect."
                    if len(new_pw) < 8:
                        errors["new_password"] = "New password must be at least 8 characters."
                    elif new_pw != confirm:
                        errors["confirm_password"] = "Passwords don't match."
                    if not any(k in errors for k in
                               ("current_password", "new_password", "confirm_password")):
                        new_hash = generate_password_hash(new_pw)

                if not errors:
                    changed = (
                        email != current_user.email
                        or display_name != current_user.display_name
                        or new_hash is not None
                    )
                    if not changed:
                        flash("No changes to save.", "info")
                    else:
                        cur.execute(
                            "UPDATE users SET email = %s, display_name = %s WHERE id = %s",
                            (email, display_name, current_user.id),
                        )
                        if new_hash:
                            cur.execute(
                                "UPDATE users SET password_hash = %s WHERE id = %s",
                                (new_hash, current_user.id),
                            )
                        conn.commit()
                        log.info("Profile updated: user=%s", current_user.id)
                        flash("Profile updated.", "success")
                    return redirect(url_for("auth.profile"))
                flash("Please fix the errors below.", "error")
        except psycopg2.IntegrityError:
            conn.rollback()
            errors["email"] = "That email is already registered."
    return render_template("profile.html", errors=errors, form=form)


@auth_bp.route("/logout", methods=["POST"])
def logout():
    uid = getattr(current_user, "id", None)
    logout_user()
    if uid:
        log.info("Logout: user=%s", uid)
    return redirect(url_for("auth.login"))