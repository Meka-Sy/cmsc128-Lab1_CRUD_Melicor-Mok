"""authHelpers.py — Flask-Login glue."""
from functools import wraps
from urllib.parse import urlparse

from flask import jsonify, make_response, redirect, request, url_for
from flask_login import (
    LoginManager, UserMixin, current_user, login_user, logout_user,
    login_required as _flask_login_required,
)
from psycopg2.extras import RealDictCursor

from db import get_db

__all__ = ["User", "login_manager", "init_auth", "is_safe_next",
           "login_user", "logout_user", "current_user", "login_required"]

login_manager = LoginManager()
login_manager.login_view = "auth.login"


class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]
        self.display_name = row["display_name"]


@login_manager.user_loader
def load_user(user_id):
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    with get_db().cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id, email, display_name FROM users WHERE id = %s", (uid,))
        row = cur.fetchone()
    return User(row) if row else None


@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Authentication required"}), 401
    return redirect(url_for("auth.login", next=request.path))


def login_required(view):
    protected = _flask_login_required(view)

    @wraps(view)
    def wrapped(*args, **kwargs):
        response = make_response(protected(*args, **kwargs))
        response.headers["Cache-Control"] = "no-store"
        return response
    return wrapped


def init_auth(app):
    login_manager.init_app(app)


def is_safe_next(target):
    if not target:
        return False
    p = urlparse(target)
    return not p.scheme and not p.netloc and target.startswith("/") and not target.startswith("//")