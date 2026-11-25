-- ============================================================================
-- schema.sql — PostgreSQL schema for the To-Do List app.
-- All statements are idempotent (IF NOT EXISTS), so this file runs safely on
-- every startup and only creates what is missing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users: application accounts. Email is unique and stored lowercased by the
-- application. Display names are unique case-insensitively via the LOWER()
-- index below (SQLite's NOCASE replacement).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT   NOT NULL UNIQUE,
    display_name  TEXT   NOT NULL,
    password_hash TEXT   NOT NULL
);

-- Case-insensitive uniqueness: "Alice" and "alice" collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name_lower
    ON users (LOWER(display_name));

-- ---------------------------------------------------------------------------
-- lists: collaborative task groups. Each list has exactly one owner.
-- Membership is tracked separately so shared lists can include non-owners.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lists (
    id       SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- list_members: many-to-many join between users and lists. The owner is
-- inserted here at list creation so "lists I can see" is one join.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS list_members (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- tasks: both personal tasks (list_id IS NULL) and list tasks (list_id set).
-- Soft deletion is tracked via deleted_at; queries filter on it. `done` is
-- an integer 0/1 so a CHECK constraint can enforce valid states.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id      INTEGER REFERENCES lists(id) ON DELETE CASCADE, -- NULL = personal
    name         TEXT    NOT NULL,
    priority     TEXT,
    tag          TEXT,
    date_created TIMESTAMPTZ DEFAULT NOW(),
    due_date     TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ,
    done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- reset_tokens: short-lived password reset links. Only the SHA-256 hash of
-- the token is stored, so a database leak cannot be used to reset passwords.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reset_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT    NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Indexes for the queries the app actually runs.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id, deleted_at);