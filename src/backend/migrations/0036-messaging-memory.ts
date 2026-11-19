import type { OpenBotMigration } from "./migration";

// Shared by migration v36 and the separate new-database schema. IF NOT EXISTS throughout.
//
// Facts that agents save about one connection (a Slack workspace, a Discord server, a Telegram chat)
// with messaging_remember. Every conversation of the connection sees them; the OpenBot user's own
// chats and the agents' private memories do not. The columns mirror `projection_channel_memories`,
// because one store implementation serves every owner. No CASCADE: no code deletes a connection
// (disconnect only disables it), and code that does must purge these rows and their
// `messaging-memory` events first.
export const MESSAGING_MEMORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_memories (
    memory_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('automatic', 'manual')),
    source_turn_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(connection_id, normalized_text)
  );
  CREATE INDEX IF NOT EXISTS messaging_memories_connection
    ON projection_messaging_memories(connection_id, updated_at DESC, memory_id);
`;

export const migration: OpenBotMigration = {
  version: 36,
  name: "messaging-memory",
  // Only creates a table, so no foreign-key pause and no vacuum. No connection has memories yet.
  up: (db) => db.exec(MESSAGING_MEMORY_SCHEMA_SQL),
};
