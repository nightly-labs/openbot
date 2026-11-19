import type { OpenBotMigration } from "./migration";

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
  up: (db) => db.exec(MESSAGING_MEMORY_SCHEMA_SQL),
};
