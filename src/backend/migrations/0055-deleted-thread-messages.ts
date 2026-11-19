import type { OpenBotMigration } from "./migration";

export const DELETED_THREAD_MESSAGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_deleted_thread_messages (
    thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL CHECK(length(message_id) > 0),
    deleted_at TEXT NOT NULL,
    PRIMARY KEY(thread_id, message_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 55,
  name: "deleted-thread-messages",
  up: (db) => db.exec(DELETED_THREAD_MESSAGES_SCHEMA_SQL),
};
