"""auth_routes.py - session config + login/register/logout routes (Flask-Login version)."""
import os
import secrets
import sqlite3
from datetime import timedelta
import re
from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from authHelpers import User, connect, current_user, is_safe_next, login_user, logout_user

auth_bp = Blueprint("auth", __name__)


USERS_SCHEMA = """
   CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT UNIQUE NOT NULL,
       display_name TEXT NOT NULL,
       password_hash TEXT NOT NULL
   )
   """


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
        elif password != confirm:
            errors["confirm_password"] = "Passwords don't match."

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

@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:          # proxy object, not a function call
        return redirect(url_for("home"))
    if request.method == "POST":
        conn = connect()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ?",
                (request.form.get("username", "").strip(),),
            ).fetchone()
        finally:
            conn.close()
        if row and check_password_hash(row["password_hash"], request.form.get("password", "")):
            session.clear()                    # prevent session fixation
            login_user(User(row))
            session.permanent = True           # cookie lasts PERMANENT_SESSION_LIFETIME
            nxt = request.args.get("next")
            return redirect(nxt if is_safe_next(nxt) else url_for("home"))
        flash("Invalid username or password.")
    return render_template("login.html", mode="login")


@auth_bp.route("/logout", methods=["POST"])   # POST so a stray link can't log you out
def logout():
    logout_user()
    return redirect(url_for("auth.login"))