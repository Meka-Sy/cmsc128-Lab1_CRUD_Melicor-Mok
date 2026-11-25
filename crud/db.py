"""db.py — PostgreSQL connection management.

Changes vs the migration version:
* DATABASE_URL is validated and `postgres://` (Render's scheme) is rewritten
  to `postgresql://` so psycopg2 accepts it.
* Pool is created once per process with connect_timeout, statement_timeout,
  and lock_timeout so a hung query can't tie up the pool forever.
* close_db rolls back before returning the connection; if rollback itself
  fails the connection is discarded instead of being reused.
"""
import logging
import os
from pathlib import Path

import psycopg2
from psycopg2 import pool as pg_pool
from flask import current_app, g

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
log = logging.getLogger(__name__)

_pool = None


def _dsn() -> str:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("DATABASE_URL is not set")
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    return raw


def init_app(app):
    global _pool
    if _pool is None:
        _pool = pg_pool.ThreadedConnectionPool(
            minconn=int(os.environ.get("DB_POOL_MIN", "1")),
            maxconn=int(os.environ.get("DB_POOL_MAX", "5")),
            dsn=_dsn(),
            connect_timeout=10,
            application_name="todo-app",
            options="-c statement_timeout=30000 -c lock_timeout=10000",
        )
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()


def get_db():
    if "db" not in g:
        g.db = _pool.getconn()
    return g.db


def close_db(exc=None):
    conn = g.pop("db", None)
    if conn is None:
        return
    try:
        conn.rollback()
    except Exception:
        _pool.putconn(conn, close=True)
        return
    _pool.putconn(conn)


def init_db():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_PATH.read_text())
        conn.commit()
    except Exception:
        conn.rollback()
        raise