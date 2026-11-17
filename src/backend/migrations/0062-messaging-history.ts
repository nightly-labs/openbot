import type { OpenBotMigration } from "./migration";

// Shared by migration v62 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The messages that a linked WhatsApp number saw in its allowed chats, also those that did not
// mention OpenBot, so an agent can read a chat after a restart. WhatsApp sends no history to a new
// device, so this is the only copy on this computer. `seq` keeps the order in which they arrived,
// also after a VACUUM, for the context of a conversation; a search reads them by `sent_at`.
// `files_json` lists the message's files, with the path of the copy that was saved when the message
// arrived. Rows and files older than 90 days go, and the copies of one number stay under 2 GB. No
// CASCADE, as for roles: a disconnect deletes the rows of its number itself.
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
  // Only creates a table and its indexes, so no foreign-key pause and no vacuum. No WhatsApp message
  // was saved before it, so the table starts empty and each number saves what it sees from then on.
  up: (db) => db.exec(MESSAGING_HISTORY_SCHEMA_SQL),
};
