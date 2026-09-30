"""authHelpers.py - Flask-Login glue for Flask + SQLite."""
import sqlite3
from functools import wraps
from urllib.parse import urlparse

from flask import current_app, jsonify, make_response, redirect, request, url_for
from flask_login import (  # re-exported so other files import everything from here
    LoginManager,
    UserMixin,
    current_user,
    login_user,
    logout_user,
    login_required as _flask_login_required,
)

__all__ = ["User", "login_manager", "init_auth", "connect", "is_safe_next",
           "login_user", "logout_user", "current_user", "login_required"]

login_manager = LoginManager()
login_manager.login_view = "auth.login"


def connect():
    conn = sqlite3.connect(current_app.config["DB"])
    conn.row_factory = sqlite3.Row
    return conn


class User(UserMixin):
    """Wraps a users-table row. UserMixin supplies is_authenticated, get_id(), etc."""
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]                 # was row["username"]: no such column
        self.display_name = row["display_name"]


@login_manager.user_loader
def load_user(user_id):
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, email, display_name FROM users WHERE id = ?", (uid,)
        ).fetchone()
    finally:
        conn.close()
    return User(row) if row else None


@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Authentication required"}), 401
    return redirect(url_for("auth.login", next=request.path))


def login_required(view):
    """Flask-Login's @login_required plus Cache-Control: no-store on protected pages."""
    protected = _flask_login_required(view)

    @wraps(view)
    def wrapped(*args, **kwargs):
        response = make_response(protected(*args, **kwargs))
        response.headers["Cache-Control"] = "no-store"
        return response
    return wrapped


def init_auth(app):
    login_manager.init_app(app)   # call AFTER the secret key is configured


def is_safe_next(target):
    """Allow only same-site relative redirects (blocks open redirects)."""
    if not target:
        return False
    p = urlparse(target)
    return not p.scheme and not p.netloc and target.startswith("/") and not target.startswith("//")