import type { OpenBotMigration } from "./migration";

export const V70_THREAD_ACTIVITY_SEQUENCE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS thread_activities_sequence
    ON projection_thread_activities(thread_id, last_event_sequence);
`;

export const migration: OpenBotMigration = {
  version: 70,
  name: "thread-activity-sequence-index",
  up: (db) => db.exec(V70_THREAD_ACTIVITY_SEQUENCE_INDEX_SQL),
};
