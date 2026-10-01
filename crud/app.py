from flask import Flask, render_template, send_from_directory, jsonify, request
import sqlite3
import os
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()
from authHelpers import login_required, init_auth, current_user
from db import get_db, init_app as init_db_app
from password_recovery import recovery_bp
from authHelpers import login_required, init_auth
from authRoutes import auth_bp, configure_session


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder="frontend/html")
DB = os.path.join(BASE_DIR, "database.db")
app.config["DB"] = DB
configure_session(app)
init_auth(app)
init_db_app(app)
app.register_blueprint(auth_bp)
app.register_blueprint(recovery_bp)

#----------DONE CHECKBOX -------------------

@app.route("/api/tasks/<int:task_id>/toggle", methods=["PATCH"])
@login_required
def toggle_task(task_id):
    conn = get_db()
    task = conn.execute(
        "SELECT done FROM tasks WHERE id = ? AND user_id = ?",
        (task_id, current_user.id)
    ).fetchone()

    if task is None:
        conn.close()
        return jsonify({"error": "Task not found"}), 404

    new_status = 0 if task["done"] else 1
    conn.execute(
        "UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?",
        (new_status, task_id, current_user.id)
    )
    conn.commit()
    conn.close()

    return jsonify({"id": task_id, "done": new_status}), 200 #checking if working



# ---------- Serve each static folder manually ----------

@app.route("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "css"), filename)

@app.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "js"), filename)

@app.route("/images/<path:filename>")
def image_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "frontend", "images"), filename)

# ---------- Database ----------

def seed_db():
    conn = get_db()
    existing = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    if existing == 0:
        sample_tasks = [
            ("Budget the allowance", "High", "Finance", datetime.now().strftime("%Y-%m-%d")),
            ("Buy groceries", "Low", "Personal", datetime.now().strftime("%Y-%m-%d")),
            ("Review pull request", "Medium", "Work", datetime.now().strftime("%Y-%m-%d")),
        ]
        conn.executemany(
            "INSERT INTO tasks (name, priority, tag, date_created) VALUES (?, ?, ?, ?)",
            sample_tasks
        )
        conn.commit()
    conn.close()

# ---------- Page routes ----------


@app.route("/")
@login_required
def home():
    conn = get_db()
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL", 
        (current_user.id,)
    ).fetchall()
    conn.close()
    return render_template("home.html", tasks=tasks)

@app.route("/deleteMode")
@login_required
def delete_mode():
    return render_template("deleteMode.html")

@app.route("/editMode")
@login_required
def edit_mode():
    return render_template("editMode.html")



# ---------- API routes ----------


@app.route("/api/tasks", methods=["GET"])
@login_required
def get_tasks():
    conn = get_db()
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL", 
        (current_user.id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(row) for row in tasks])

@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    data = request.get_json() or {}
    name = data.get("name")
    priority = data.get("priority", "Low")
    tag = data.get("tag", "General")
    raw_date = data.get("due_date")
    due_date = raw_date if raw_date else None
    date_created = datetime.now().strftime("%Y-%m-%d")

    if not name:
        return jsonify({"error": "Task name is required"}), 400

    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO tasks (user_id, name, priority, tag, date_created, due_date) VALUES (?, ?, ?, ?, ?, ?)",
        (current_user.id, name, priority, tag, date_created, due_date)
    )
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "id": task_id, 
        "name": name, 
        "priority": priority, 
        "tag": tag, 
        "date_created": date_created,
        "due_date": due_date
    }), 201

@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    conn = get_db()
    result = conn.execute(
        "DELETE FROM tasks WHERE id = ? AND user_id = ?",
        (task_id, current_user.id)
    )
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"status": "deleted", "id": task_id}), 200

@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task(task_id):
    data = request.get_json() or {}
    name = data.get("name")
    priority = data.get("priority", "Low")
    tag = data.get("tag", "General")
    raw_date = data.get("due_date")
    due_date = raw_date if raw_date else None

    if not name:
        return jsonify({"error": "Task name is required"}), 400

    conn = get_db()
    result = conn.execute(
        "UPDATE tasks SET name = ?, priority = ?, tag = ?, due_date = ? WHERE id = ? AND user_id = ?",
        (name, priority, tag, due_date, task_id, current_user.id)
    )
    conn.commit()

    if result.rowcount == 0:
        conn.close()
        return jsonify({"error": "Task not found"}), 404

    # date_created is intentionally left untouched by the UPDATE above —
    # re-select the row so the response (and whatever replaces it client-side) still has it
    updated_row = conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user.id)).fetchone()
    conn.close()

    return jsonify(dict(updated_row)), 200


if __name__ == "__main__":
    app.run(debug=True)