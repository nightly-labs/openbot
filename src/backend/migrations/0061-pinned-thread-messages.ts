import type { OpenBotMigration } from "./migration";

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

export const migration: OpenBotMigration = {
  version: 61,
  name: "pinned-thread-messages",
  up: (db) => db.exec(PINNED_THREAD_MESSAGES_SCHEMA_SQL),
};
