"""collabLists.py — collaborative list API.

Changes vs the migration version:
* Logging added for create/delete/member-add. No logic changes.
"""
import logging

from flask import Blueprint, jsonify, request, session
from psycopg2.extras import RealDictCursor

from authHelpers import current_user, login_required
from db import get_db

lists_bp = Blueprint("lists", __name__, url_prefix="/api/lists")
log = logging.getLogger(__name__)


def _json():
    return request.get_json(silent=True) or {}


@lists_bp.route("", methods=["GET"])
@login_required
def my_lists():
    conn = get_db()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT l.id, l.name, (l.owner_id = %s) AS is_owner
               FROM lists l
               JOIN list_members m ON m.list_id = l.id
               WHERE m.user_id = %s
               ORDER BY LOWER(l.name)""",
            (current_user.id, current_user.id),
        )
        rows = cur.fetchall()
    active = session.get("list_id")
    if active is not None and active not in {r["id"] for r in rows}:
        session.pop("list_id", None)
        active = None
    return jsonify({"active": active, "lists": [dict(r) for r in rows]})


@lists_bp.route("", methods=["POST"])
@login_required
def create_list():
    name = str(_json().get("name", "")).strip()[:60]
    if not name:
        return jsonify({"error": "List name is required"}), 400
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO lists (owner_id, name) VALUES (%s, %s) RETURNING id",
            (current_user.id, name),
        )
        list_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO list_members (list_id, user_id) VALUES (%s, %s)",
            (list_id, current_user.id),
        )
    conn.commit()
    log.info("List created: id=%s owner=%s", list_id, current_user.id)
    return jsonify({"id": list_id, "name": name, "is_owner": 1}), 201


@lists_bp.route("/active", methods=["PUT"])
@login_required
def set_active():
    lid = _json().get("list_id")
    if lid is None:
        session.pop("list_id", None)
        return jsonify({"active": None})
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM list_members WHERE list_id = %s AND user_id = %s",
            (lid, current_user.id),
        )
        ok = cur.fetchone() is not None
    if not ok:
        return jsonify({"error": "List not found"}), 404
    session["list_id"] = lid
    return jsonify({"active": lid})


@lists_bp.route("/<int:list_id>/members", methods=["GET"])
@login_required
def get_members(list_id):
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM list_members WHERE list_id = %s AND user_id = %s",
            (list_id, current_user.id),
        )
        if cur.fetchone() is None:
            return jsonify({"error": "Access denied"}), 403
        cur.execute(
            """SELECT u.id, u.display_name
               FROM users u
               JOIN list_members m ON m.user_id = u.id
               WHERE m.list_id = %s
               ORDER BY LOWER(u.display_name)""",
            (list_id,),
        )
        members = cur.fetchall()
    return jsonify([{"id": r[0], "display_name": r[1]} for r in members])


@lists_bp.route("/<int:list_id>/members", methods=["POST"])
@login_required
def add_member(list_id):
    ident = str(_json().get("user", "")).strip()
    if not ident:
        return jsonify({"error": "Enter a username or email"}), 400
    conn = get_db()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT 1 FROM lists WHERE id = %s AND owner_id = %s",
            (list_id, current_user.id),
        )
        if cur.fetchone() is None:
            return jsonify({"error": "Only the list owner can add members"}), 403
        cur.execute(
            "SELECT id, display_name FROM users "
            "WHERE email = %s OR LOWER(display_name) = LOWER(%s)",
            (ident.lower(), ident),
        )
        user = cur.fetchone()
        if not user:
            return jsonify({"error": "No user found with that username or email"}), 404
        cur.execute(
            "INSERT INTO list_members (list_id, user_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (list_id, user["id"]),
        )
        already = cur.rowcount == 0
    conn.commit()
    if not already:
        log.info("Member added: list=%s user=%s", list_id, user["id"])
    return jsonify({
        "id": user["id"],
        "display_name": user["display_name"],
        "already": already,
    }), (200 if already else 201)


@lists_bp.route("/<int:list_id>", methods=["PATCH"])
@login_required
def rename_list(list_id):
    name = str(_json().get("name", "")).strip()[:60]
    if not name:
        return jsonify({"error": "List name is required"}), 400
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE lists SET name = %s WHERE id = %s AND owner_id = %s",
            (name, list_id, current_user.id),
        )
        affected = cur.rowcount
    conn.commit()
    if affected == 0:
        return jsonify({"error": "Only the list owner can rename this list"}), 403
    return jsonify({"id": list_id, "name": name})


@lists_bp.route("/<int:list_id>", methods=["DELETE"])
@login_required
def delete_list(list_id):
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM lists WHERE id = %s AND owner_id = %s",
            (list_id, current_user.id),
        )
        if cur.fetchone() is None:
            return jsonify({"error": "Only the list owner can delete this list"}), 403
        cur.execute("DELETE FROM lists WHERE id = %s", (list_id,))
    conn.commit()
    if session.get("list_id") == list_id:
        session.pop("list_id", None)
    log.info("List deleted: id=%s", list_id)
    return jsonify({"status": "deleted", "id": list_id})