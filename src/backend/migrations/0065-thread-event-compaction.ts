import type { OpenBotMigration } from "./migration";

export const THREAD_EVENT_COMPACTION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS thread_event_compaction (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    through_sequence INTEGER NOT NULL CHECK(through_sequence >= 0),
    compacted_at TEXT NOT NULL
  );
`;

export const THREAD_EVENT_COMPACTION_TABLES_AFTER_MIGRATION: Record<string, never[]> = {
  thread_event_compaction: [],
};

export const migration: OpenBotMigration = {
  version: 65,
  name: "thread-event-compaction",
  up: (db) => db.exec(THREAD_EVENT_COMPACTION_SCHEMA_SQL),
};
