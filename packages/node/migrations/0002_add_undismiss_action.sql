-- Allow undismiss rows. Recreate the table so SQLite and Postgres stay in sync.
CREATE TABLE plgkit_events_new (
    id TEXT PRIMARY KEY,
    nudge_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('impression', 'click', 'dismiss', 'undismiss')),
    user_id TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO plgkit_events_new (id, nudge_id, action, user_id, context, created_at)
SELECT id, nudge_id, action, user_id, context, created_at FROM plgkit_events;

DROP TABLE plgkit_events;

ALTER TABLE plgkit_events_new RENAME TO plgkit_events;

CREATE INDEX IF NOT EXISTS plgkit_events_user_nudge_action
    ON plgkit_events (user_id, nudge_id, action);
