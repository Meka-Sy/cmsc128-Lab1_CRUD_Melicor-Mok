"""app.py — Flask application entrypoint.

Changes vs the migration version:
* ProxyFix is applied so `_external=True` URL generation produces https://
  links behind Render's TLS-terminating proxy. Without this, password reset
  emails contain http:// URLs that redirect to https:// but break framing.
* Error handlers return JSON for /api/ paths and plain HTML for pages so
  nothing leaks a stack trace in production.
* Security headers are added on every response (nosniff, X-Frame-Options,
  Referrer-Policy, Permissions-Policy, HSTS over HTTPS).
* /healthz pings the database so Render can restart the service if it
  becomes unresponsive.
* Logging is configured once at startup instead of scattered print() calls.
"""
import logging
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory
from psycopg2.extras import RealDictCursor
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

from authHelpers import login_required, init_auth, current_user
from db import get_db, init_app as init_db_app
from password_recovery import recovery_bp
from authRoutes import auth_bp, configure_session
from collabLists import lists_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger(__name__)

app = Flask(__name__, template_folder="frontend/html")

from datetime import date, datetime
from flask.json.provider import DefaultJSONProvider

class ISOJSONProvider(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, (datetime, date)):
            # Emit date-only to match the original SQLite behavior:
            # "2026-09-10" instead of "Wed, 25 Nov 2026 ...".
            return o.date().isoformat() if isinstance(o, datetime) else o.isoformat()
        return DefaultJSONProvider.default(o)

app.json = ISOJSONProvider(app)

# Trust the one proxy hop Render adds in front of the app.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# init order matters: configure_session sets SECRET_KEY which Flask-Login
# reads during init_auth, and init_db_app needs a live app context.
configure_session(app)
init_auth(app)
init_db_app(app)
app.register_blueprint(auth_bp)
app.register_blueprint(recovery_bp)
app.register_blueprint(lists_bp)


# ---------------------------------------------------------------------------
# Error handlers — never leak tracebacks, consistent JSON for /api/
# ---------------------------------------------------------------------------

def _error_response(code, message):
    if request.path.startswith("/api/"):
        return jsonify({"error": message}), code
    return f"<h1>{code}</h1><p>{message}</p>", code


@app.errorhandler(400)
def _bad_request(e):
    return _error_response(400, getattr(e, "description", "Bad request"))


@app.errorhandler(401)
def _unauthorized(e):
    return _error_response(401, "Authentication required")


@app.errorhandler(403)
def _forbidden(e):
    return _error_response(403, "Forbidden")


@app.errorhandler(404)
def _not_found(e):
    return _error_response(404, "Not found")


@app.errorhandler(405)
def _method_not_allowed(e):
    return _error_response(405, "Method not allowed")


@app.errorhandler(500)
def _server_error(e):
    log.exception("Unhandled exception")
    return _error_response(500, "Internal server error")


# ---------------------------------------------------------------------------
# Response headers
# ---------------------------------------------------------------------------

@app.after_request
def no_store(resp):
    if current_user.is_authenticated or request.endpoint in ("auth.login", "auth.register"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if request.is_secure:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/healthz")
def healthz():
    try:
        with get_db().cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:
        log.exception("Health check failed")
        return jsonify({"status": "error"}), 503
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Scoping helpers (unchanged)
# ---------------------------------------------------------------------------

def task_scope(conn):
    from flask import session
    lid = session.get("list_id")
    if lid is not None:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM list_members WHERE list_id = %s AND user_id = %s",
                (lid, current_user.id),
            )
            if cur.fetchone():
                return "list_id = %s", (lid,), lid
        session.pop("list_id", None)
    return "list_id IS NULL AND user_id = %s", (current_user.id,), None


def active_list_name(conn):
    _, _, lid = task_scope(conn)
    if lid is None:
        return "Personal"
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT name FROM lists WHERE id = %s", (lid,))
        row = cur.fetchone()
        return row["name"]


# ---------------------------------------------------------------------------
# Task and page routes (logic unchanged from the migration version)
# ---------------------------------------------------------------------------

@app.route("/api/tasks/<int:task_id>/toggle", methods=["PATCH"])
@login_required
def toggle_task(task_id):
    conn = get_db()
    where, args, _ = task_scope(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT done FROM tasks WHERE id = %s AND {where} AND deleted_at IS NULL",
            (task_id, *args),
        )
        row = cur.fetchone()
    if row is None:
        return jsonify({"error": "Task not found"}), 404
    new_status = 0 if row[0] else 1
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE tasks SET done = %s WHERE id = %s AND {where}",
            (new_status, task_id, *args),
        )
    conn.commit()
    return jsonify({"id": task_id, "done": new_status}), 200


@app.route("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "css"), filename)


@app.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "js"), filename)


@app.route("/images/<path:filename>")
def image_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "images"), filename)


@app.route("/")
@login_required
def home():
    conn = get_db()
    where, args, _ = task_scope(conn)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"SELECT * FROM tasks WHERE {where} AND deleted_at IS NULL ORDER BY id DESC",
            args,
        )
        tasks = cur.fetchall()
    return render_template("home.html", tasks=tasks)


@app.route("/deleteMode")
@login_required
def delete_mode():
    return render_template("deleteMode.html", list_name=active_list_name(get_db()))


@app.route("/editMode")
@login_required
def edit_mode():
    return render_template("editMode.html", list_name=active_list_name(get_db()))


@app.route("/api/tasks", methods=["GET"])
@login_required
def get_tasks():
    conn = get_db()
    where, args, _ = task_scope(conn)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"SELECT * FROM tasks WHERE {where} AND deleted_at IS NULL ORDER BY id DESC",
            args,
        )
        tasks = cur.fetchall()
    return jsonify([dict(row) for row in tasks])


@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    priority = data.get("priority", "Low")
    tag = data.get("tag", "General")
    due_date = data.get("due_date") or None

    if not name:
        return jsonify({"error": "Task name is required"}), 400
    if priority not in {"Low", "Medium", "High"}:
        return jsonify({"error": "Invalid priority"}), 400

    conn = get_db()
    _, _, list_id = task_scope(conn)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """INSERT INTO tasks (user_id, list_id, name, priority, tag, due_date)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, date_created""",
            (current_user.id, list_id, name, priority, tag, due_date),
        )
        task_id, date_created = cur.fetchone().values()
    conn.commit()
    return jsonify({
        "id": task_id,
        "name": name,
        "priority": priority,
        "tag": tag,
        "date_created": date_created.isoformat(),
        "due_date": due_date,
        "done": 0,
    }), 201


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    conn = get_db()
    where, args, _ = task_scope(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE tasks SET deleted_at = NOW() "
            f"WHERE id = %s AND {where} AND deleted_at IS NULL",
            (task_id, *args),
        )
        affected = cur.rowcount
    conn.commit()
    if affected == 0:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"status": "deleted", "id": task_id}), 200


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task(task_id):
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Task name is required"}), 400
    priority = data.get("priority", "Low")
    tag = data.get("tag", "General")
    due_date = data.get("due_date") or None

    conn = get_db()
    where, args, _ = task_scope(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"""UPDATE tasks SET name = %s, priority = %s, tag = %s, due_date = %s
                WHERE id = %s AND {where} AND deleted_at IS NULL""",
            (name, priority, tag, due_date, task_id, *args),
        )
        affected = cur.rowcount
    conn.commit()
    if affected == 0:
        return jsonify({"error": "Task not found"}), 404

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"SELECT * FROM tasks WHERE id = %s AND {where} AND deleted_at IS NULL",
            (task_id, *args),
        )
        updated_row = cur.fetchone()
    return jsonify(dict(updated_row)), 200


if __name__ == "__main__":
    app.run(debug=True)