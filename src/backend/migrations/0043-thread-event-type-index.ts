import type { OpenBotMigration } from "./migration";

export const V43_THREAD_EVENT_TYPE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS orchestration_events_thread_type
    ON orchestration_events(aggregate_id, event_type, sequence) WHERE aggregate_type = 'thread';
`;

export const migration: OpenBotMigration = {
  version: 43,
  name: "thread-event-type-index",
  up: (db) => db.exec(V43_THREAD_EVENT_TYPE_INDEX_SQL),
};
