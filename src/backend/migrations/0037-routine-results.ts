import type { OpenBotMigration } from "./migration";

export const ROUTINE_RESULT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS routine_result_destinations (
    routine_id TEXT PRIMARY KEY REFERENCES projection_agent_routines(routine_id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    platform TEXT NOT NULL,
    connection_name TEXT NOT NULL,
    place_id TEXT NOT NULL,
    place_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routine_result_deliveries (
    run_id TEXT PRIMARY KEY REFERENCES projection_routine_runs(run_id) ON DELETE CASCADE,
    routine_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    connection_name TEXT NOT NULL,
    place_id TEXT NOT NULL,
    place_name TEXT NOT NULL,
    text TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'quiet')),
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    next_attempt_at TEXT,
    expires_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS routine_result_deliveries_routine
    ON routine_result_deliveries(routine_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS routine_result_deliveries_status
    ON routine_result_deliveries(status, next_attempt_at);
`;

export const migration: OpenBotMigration = {
  version: 37,
  name: "routine-results",
  up: (db) => db.exec(ROUTINE_RESULT_SCHEMA_SQL),
};
