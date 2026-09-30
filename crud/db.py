#db.py - SQLite connection per request (sqlite3.Row)
import sqlite3
from pathlib import Path

from flask import current_app, g

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DB"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    # Create missing tables (CREATE TABLE IF NOT EXISTS)
    conn = get_db()
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    # migration for databases created before deleted_at existed
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
    if "deleted_at" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN deleted_at TEXT")
    conn.commit()


def init_app(app):
    # Call after app.config['DB'] is set
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()