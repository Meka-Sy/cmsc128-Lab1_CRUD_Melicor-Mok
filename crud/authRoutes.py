"""auth_routes.py - session config + login/register/logout routes (Flask-Login version)."""
import os
import secrets
import sqlite3
from datetime import timedelta
import re
from xml.parsers.expat import errors
from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from authHelpers import User, connect, current_user, is_safe_next, login_required, login_user, logout_user

auth_bp = Blueprint("auth", __name__)


def configure_session(app):
    # Flask-Login stores the user ID in Flask's signed-cookie session;
    # SECRET_KEY is what signs it. 
    # But SECRET_KEY would be needed for the real use 
    # Otherwise every server restart will log out all the users if there's no SECRET_KEY
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=not app.debug,   # HTTPS-only outside debug
    )

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")  # near the top, with `import re`

@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("auth.profile"))

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
        if not form.get("confirm_password"):
            errors["confirm"] = "Please confirm your password."
        elif form.get("password") != form.get("confirm"):
            errors["confirm"] = "Passwords don't match."
        

        if not errors:
            conn = connect()
            try:
                if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                    errors["email"] = "That email is already registered."
                else:
                    conn.execute(
                        "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)",
                        (email, display_name, generate_password_hash(password)),
                    )
                    conn.commit()
                    flash("Account created. Please log in.", "success")
                    return redirect(url_for("auth.login"))
            except sqlite3.IntegrityError:
                errors["email"] = "That email is already registered."
            finally:
                conn.close()

    return render_template("login.html", mode="register", errors=errors, form=form)

# hash of a throwaway password, checked when the email doesn't exist so timing doesn't leak which emails are registered
_DUMMY_HASH = generate_password_hash("not-a-real-password")


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:          # proxy object, not a function call
        return redirect(url_for("auth.profile"))
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        finally:
            conn.close()
        ok = check_password_hash(row["password_hash"] if row else _DUMMY_HASH, password)
        if row and ok:
            session.clear()                    # prevent session fixation
            login_user(User(row))
            session.permanent = True           # cookie lasts PERMANENT_SESSION_LIFETIME
            nxt = request.args.get("next")
            return redirect(nxt if is_safe_next(nxt) else url_for("auth.profile"))
        flash("Invalid email or password.", "error")   # one generic message
    return render_template("login.html", mode="login")

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
        form = {"email": email, "display_name": display_name}   # re-shown on error, so edits aren't lost

        if not email:
            errors["email"] = "Email is required."
        elif not EMAIL_RE.match(email):
            errors["email"] = "Enter a valid email address."
        if not display_name:
            errors["display_name"] = "Display name is required."

        changing_pw = bool(current_pw or new_pw or confirm)
        conn = connect()
        try:
            # uniqueness check excludes the user's own row
            if "email" not in errors and email != current_user.email:
                if conn.execute("SELECT 1 FROM users WHERE email = ? AND id != ?",
                                (email, current_user.id)).fetchone():
                    errors["email"] = "That email is already registered."

            new_hash = None
            if changing_pw:
                row = conn.execute("SELECT password_hash FROM users WHERE id = ?",
                                   (current_user.id,)).fetchone()
                if not check_password_hash(row["password_hash"], current_pw):
                    errors["current_password"] = "Current password is incorrect."
                if len(new_pw) < 8:
                    errors["new_password"] = "New password must be at least 8 characters."
                elif new_pw != confirm:
                    errors["confirm_password"] = "Passwords don't match."
                if not any(k in errors for k in ("current_password", "new_password", "confirm_password")):
                    new_hash = generate_password_hash(new_pw)

            if not errors:
                changed = (email != current_user.email or display_name != current_user.display_name
                           or new_hash is not None)
                if not changed:
                    flash("No changes to save.", "info")
                else:
                    # all-or-nothing: nothing is written unless every field validated
                    conn.execute("UPDATE users SET email = ?, display_name = ? WHERE id = ?",
                                 (email, display_name, current_user.id))
                    if new_hash:
                        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                                     (new_hash, current_user.id))
                    conn.commit()
                    flash("Profile updated.", "success")
                return redirect(url_for("auth.profile"))   # redirect after POST: refresh won't resubmit
            flash("Please fix the errors below.", "error")
        except sqlite3.IntegrityError:
            errors["email"] = "That email is already registered."
        finally:
            conn.close()
    return render_template("profile.html", errors=errors, form=form)


@auth_bp.route("/logout", methods=["POST"])   # POST so a stray link can't log you out
def logout():
    logout_user()
    return redirect(url_for("auth.login"))