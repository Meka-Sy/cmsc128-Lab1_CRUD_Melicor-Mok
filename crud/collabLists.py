"""collabLists.py - collaborative list routes. Active list is kept in the session (None = personal)."""
from flask import Blueprint, jsonify, request, session

from authHelpers import connect, current_user, login_required

# Initialize Blueprint for collaborative list routes with a common URL prefix
lists_bp = Blueprint("lists", __name__, url_prefix="/api/lists")


# Helper function to extract JSON payload safely from incoming requests
def _json():
    return request.get_json(silent=True) or {}


# GET /api/lists - Fetch all collaborative lists accessible to the current user
@lists_bp.route("", methods=["GET"])
@login_required
def my_lists():
    """Only lists the current user is a member of."""
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT l.id, l.name, (l.owner_id = ?) AS is_owner FROM lists l "
            "JOIN list_members m ON m.list_id = l.id WHERE m.user_id = ? "
            "ORDER BY l.name COLLATE NOCASE",
            (current_user.id, current_user.id),
        ).fetchall()
    finally:
        conn.close()
    active = session.get("list_id")
    if active is not None and active not in {r["id"] for r in rows}:
        session.pop("list_id", None)      # list was deleted or access was lost
        active = None
    return jsonify({"active": active, "lists": [dict(r) for r in rows]})


# POST /api/lists - Create a new collaborative list and assign the current user as owner
@lists_bp.route("", methods=["POST"])
@login_required
def create_list():
    name = str(_json().get("name", "")).strip()[:60]
    if not name:
        return jsonify({"error": "List name is required"}), 400
    conn = connect()
    try:
        cur = conn.execute("INSERT INTO lists (owner_id, name) VALUES (?, ?)", (current_user.id, name))
        conn.execute("INSERT INTO list_members (list_id, user_id) VALUES (?, ?)", (cur.lastrowid, current_user.id))
        conn.commit()
        return jsonify({"id": cur.lastrowid, "name": name, "is_owner": 1}), 201
    finally:
        conn.close()


# PUT /api/lists/active - Set or clear the active list ID in the current session
@lists_bp.route("/active", methods=["PUT"])
@login_required
def set_active():
    """list_id = null switches back to the personal list."""
    lid = _json().get("list_id")
    if lid is None:
        session.pop("list_id", None)
        return jsonify({"active": None})
    conn = connect()
    try:
        ok = isinstance(lid, int) and conn.execute(
            "SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?", (lid, current_user.id)
        ).fetchone()
    finally:
        conn.close()
    if not ok:
        return jsonify({"error": "List not found"}), 404
    session["list_id"] = lid
    return jsonify({"active": lid})


# GET /api/lists/<list_id>/members - Retrieve all members belonging to a list
@lists_bp.route("/<int:list_id>/members", methods=["GET"])
@login_required
def get_members(list_id):
    """Get all members of a list (available to list members)."""
    conn = connect()
    try:
        # Check membership first
        if not conn.execute("SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?",
                            (list_id, current_user.id)).fetchone():
            return jsonify({"error": "Access denied"}), 403

        members = conn.execute(
            "SELECT u.id, u.display_name FROM users u "
            "JOIN list_members m ON m.user_id = u.id WHERE m.list_id = ? "
            "ORDER BY u.display_name COLLATE NOCASE",
            (list_id,)
        ).fetchall()
        return jsonify([dict(m) for m in members])
    finally:
        conn.close()


# POST /api/lists/<list_id>/members - Add a new member to a list (Owner permission required)
@lists_bp.route("/<int:list_id>/members", methods=["POST"])
@login_required
def add_member(list_id):
    """Owner adds a user by email or display name (username)."""
    ident = str(_json().get("user", "")).strip()
    if not ident:
        return jsonify({"error": "Enter a username or email"}), 400
    conn = connect()
    try:
        if not conn.execute("SELECT 1 FROM lists WHERE id = ? AND owner_id = ?",
                            (list_id, current_user.id)).fetchone():
            return jsonify({"error": "Only the list owner can add members"}), 403
        user = conn.execute(
            "SELECT id, display_name FROM users WHERE email = ? OR display_name = ? COLLATE NOCASE",
            (ident.lower(), ident),
        ).fetchone()
        if not user:
            return jsonify({"error": "No user found with that username or email"}), 404
        cur = conn.execute("INSERT OR IGNORE INTO list_members (list_id, user_id) VALUES (?, ?)",
                           (list_id, user["id"]))
        conn.commit()
        already = cur.rowcount == 0
        return jsonify({"id": user["id"], "display_name": user["display_name"], "already": already}), (200 if already else 201)
    finally:
        conn.close()


# PATCH /api/lists/<list_id> - Rename an existing list (Owner permission required)
@lists_bp.route("/<int:list_id>", methods=["PATCH"])
@login_required
def rename_list(list_id):
    name = str(_json().get("name", "")).strip()[:60]
    if not name:
        return jsonify({"error": "List name is required"}), 400
    conn = connect()
    try:
        cur = conn.execute("UPDATE lists SET name = ? WHERE id = ? AND owner_id = ?",
                           (name, list_id, current_user.id))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Only the list owner can rename this list"}), 403
        return jsonify({"id": list_id, "name": name})
    finally:
        conn.close()


# DELETE /api/lists/<list_id> - Delete a list along with its tasks and member records
@lists_bp.route("/<int:list_id>", methods=["DELETE"])
@login_required
def delete_list(list_id):
    conn = connect()
    try:
        if not conn.execute("SELECT 1 FROM lists WHERE id = ? AND owner_id = ?",
                            (list_id, current_user.id)).fetchone():
            return jsonify({"error": "Only the list owner can delete this list"}), 403
        # explicit cascade: this connection doesn't enable PRAGMA foreign_keys
        conn.execute("DELETE FROM tasks WHERE list_id = ?", (list_id,))
        conn.execute("DELETE FROM list_members WHERE list_id = ?", (list_id,))
        conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))
        conn.commit()
    finally:
        conn.close()
    if session.get("list_id") == list_id:
        session.pop("list_id", None)
    return jsonify({"status": "deleted", "id": list_id})