import type { OpenBotMigration } from "./migration";

// The threads whose old events OpenBot compacted after start (`ThreadEventCompaction`). A row means
// that each event of the thread up to `through_sequence` keeps only the `changedMessages` items that
// a replay needs; later events have the small shape that writes use since #8166 and #8794. A thread
// with no row is compacted again from its first event, so a kill during its compaction loses no
// data. The row goes with its thread.
export const THREAD_EVENT_COMPACTION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS thread_event_compaction (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    through_sequence INTEGER NOT NULL CHECK(through_sequence >= 0),
    compacted_at TEXT NOT NULL
  );
`;

/** The progress table right after migration 65, for the migration tests of earlier versions. */
export const THREAD_EVENT_COMPACTION_TABLES_AFTER_MIGRATION: Record<string, never[]> = {
  thread_event_compaction: [],
};

export const migration: OpenBotMigration = {
  version: 65,
  name: "thread-event-compaction",
  // Only creates a table, so no foreign-key pause and no vacuum. The compaction itself runs after
  // start, in small transactions, and changes only event payloads, to the same shape. A release
  // before this version refuses the database (`NewerDatabaseError`), so no older replay reads them.
  up: (db) => db.exec(THREAD_EVENT_COMPACTION_SCHEMA_SQL),
};
