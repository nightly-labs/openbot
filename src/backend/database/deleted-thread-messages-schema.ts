// Shared by migration v55 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The messages that a person deleted from a thread. A delete removes the projection row, its
// attachments and its mailbox copy, but other sources can write the same id again: a full snapshot
// that the runtime still holds, a provider history import, mailbox reconciliation or an event replay.
// Each of these writers skips an id in this table, so a delete stays in effect across restarts.
// The row goes with its thread.
export const DELETED_THREAD_MESSAGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_deleted_thread_messages (
    thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL CHECK(length(message_id) > 0),
    deleted_at TEXT NOT NULL,
    PRIMARY KEY(thread_id, message_id)
  );
`;
