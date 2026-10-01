CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    priority TEXT,
    tag TEXT,
    date_created TEXT,
    due_date TEXT,
    deleted_at TEXT,
    done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL
);
-- this is for the duplicate display name as well as the email duplicate
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name
ON users(display_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,      -- SHA-256 of the token; raw token is never stored
    expires_at TEXT NOT NULL,             -- ISO-8601 UTC
    used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON reset_tokens(user_id);