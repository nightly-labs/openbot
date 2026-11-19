import type { OpenBotMigration } from "./migration";

export const MESSAGING_HISTORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_history (
    seq INTEGER PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    platform_channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    files_json TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    UNIQUE (connection_id, platform_channel_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_projection_messaging_history_place
    ON projection_messaging_history(connection_id, platform_channel_id, seq);
  CREATE INDEX IF NOT EXISTS idx_projection_messaging_history_sent
    ON projection_messaging_history(connection_id, platform_channel_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_projection_messaging_history_saved
    ON projection_messaging_history(saved_at);
`;

export const migration: OpenBotMigration = {
  version: 62,
  name: "messaging-history",
  up: (db) => db.exec(MESSAGING_HISTORY_SCHEMA_SQL),
};
