"""auth_routes.py - session config + login/register/logout routes (Flask-Login version)."""
import os
import secrets
import sqlite3
from datetime import timedelta

from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from authHelpers import User, connect, current_user, is_safe_next, login_user, logout_user

auth_bp = Blueprint("auth", __name__)

USERS_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
)
"""


def configure_session(app):
    # Flask-Login stores the user ID in Flask's signed-cookie session;
    # SECRET_KEY is what signs it. Set SECRET_KEY in the environment for real use.
    # The random fallback logs everyone out on every restart (dev only).
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=not app.debug,   # HTTPS-only outside debug
    )


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or len(password) < 8:
            flash("Username is required and password must be at least 8 characters.")
        else:
            conn = connect()
            try:
                conn.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                conn.commit()
                flash("Account created. Please log in.")
                return redirect(url_for("auth.login"))
            except sqlite3.IntegrityError:
                flash("That username is taken.")
            finally:
                conn.close()
    return render_template("login.html", mode="register")


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