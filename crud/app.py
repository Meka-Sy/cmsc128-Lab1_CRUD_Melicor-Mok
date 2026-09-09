from flask import Flask, render_template, send_from_directory, jsonify
import sqlite3
import os
from datetime import datetime


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder="html")
DB = os.path.join(BASE_DIR, "database.db")




   
# ---------- Serve each static folder manually ----------

@app.route("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "css"), filename)

@app.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "js"), filename)

@app.route("/images/<path:filename>")
def image_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "images"), filename)

# ---------- Database ----------

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            priority TEXT,
            tag TEXT,
            date_created TEXT,
            deleted_at TEXT
        )
    """)
    conn.commit()
    conn.close()
def migrate_add_deleted_at():
    conn = get_db()
    cols = [row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
    if "deleted_at" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN deleted_at TEXT")
        conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    existing = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    if existing == 0:
        sample_tasks = [
            ("Finish CRUD project", "High", "School", datetime.now().strftime("%Y-%m-%d")),
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
def home():
    conn = get_db()
    tasks = conn.execute("SELECT * FROM tasks WHERE deleted_at IS NULL").fetchall()
    conn.close()
    return render_template("home.html", tasks=tasks)

@app.route("/deleteMode")
def delete_mode():
    return render_template("deleteMode.html")

@app.route("/editMode")
def edit_mode():
    return render_template("editMode.html")



# ---------- API routes ----------





@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    conn = get_db()
    tasks = conn.execute("SELECT * FROM tasks").fetchall()
    conn.close()
    return jsonify([dict(row) for row in tasks])

@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    conn = get_db()
    result = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"status": "deleted", "id": task_id}), 200


if __name__ == "__main__":
    init_db()
    seed_db()

    app.run(debug=True)