// Shared by migration v61 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The messages that a person or the agent pinned in a thread: the agent's own chat or one of its side
// threads. A row names a shown message of `projection_thread_messages`. It has no foreign key to that
// table: a thread replay deletes and inserts every message row again, and a cascade would remove each
// pin. The delete of a message removes its pin in the same transaction. The row goes with its thread.
//
// Who pinned it: the agent of the chat (`agent`, with its id), or a person (`person`). A member of a
// joined server has an id and a name; the user of this computer has neither.
export const PINNED_THREAD_MESSAGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_pinned_thread_messages (
    thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL CHECK(length(message_id) > 0),
    pinned_at TEXT NOT NULL,
    pinned_by_kind TEXT NOT NULL CHECK(pinned_by_kind IN ('person', 'agent')),
    pinned_by_id TEXT CHECK(pinned_by_id IS NULL OR length(pinned_by_id) > 0),
    pinned_by_name TEXT,
    PRIMARY KEY(thread_id, message_id),
    CHECK(
      (pinned_by_kind = 'agent' AND pinned_by_id IS NOT NULL AND pinned_by_name IS NULL) OR
      (pinned_by_kind = 'person' AND (pinned_by_id IS NULL) = (pinned_by_name IS NULL))
    )
  );
`;
