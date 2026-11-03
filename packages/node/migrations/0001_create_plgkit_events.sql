-- Saved impression, click, and dismiss rows.
-- Rows are only added. Later changes get a new numbered file; `plgkit migrate` applies new files.
-- This file runs on SQLite and Postgres. context is JSON stored as text, so one file is enough.
-- created_at is UTC, stored as text.

CREATE TABLE IF NOT EXISTS plgkit_events (
    id TEXT PRIMARY KEY,
    nudge_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('impression', 'click', 'dismiss')),
    user_id TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS plgkit_events_user_nudge_action
    ON plgkit_events (user_id, nudge_id, action);
