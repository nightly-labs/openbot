import type { OpenBotMigration } from "./migration";

// Migration 43 indexes thread events by type. Each stream flush looks up the earlier streamed-message
// events of its thread by type, which without it reads every earlier event of the thread (#2278). Only
// that lookup reads it, so it is partial: other aggregates do not pay its write cost. Frozen with the migration.
export const V43_THREAD_EVENT_TYPE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS orchestration_events_thread_type
    ON orchestration_events(aggregate_id, event_type, sequence) WHERE aggregate_type = 'thread';
`;

export const migration: OpenBotMigration = {
  version: 43,
  name: "thread-event-type-index",
  // Only creates an index, so no foreign-key pause and no vacuum.
  up: (db) => db.exec(V43_THREAD_EVENT_TYPE_INDEX_SQL),
};
