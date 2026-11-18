import type { OpenBotMigration } from "./migration";

// Shared by migration v37 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// A routine result is the answer of an agent routine's run, sent on to a place outside OpenBot. The
// rows are written directly, not through `database.dispatch`: a delivery holds the answer text, and
// the event log is never deleted from.
//
// `routine_result_destinations`: the one place a routine sends its answers to. The names are the ones
// the user picked, kept so the editor can name a place whose connection does not run now. A connection
// row is never deleted, only turned off, so the reference never blocks a delete.
//
// `routine_result_deliveries`: one run's answer and what became of it, at most one per run. The row
// keeps its own copy of the place, so a later change of the routine's destination does not move an
// answer that is already on its way. `text` is null only for a quiet run, which sends nothing.
// `status`:
// - `pending` waits for `next_attempt_at`, or until `expires_at` ends it as `failed`.
// - `sending` is set before the post starts. A restart finds it `uncertain`: a long answer goes in more
//   than one post, so a part of it can be posted already.
// - `sent`, `failed` and `uncertain` end the row until the user sends it again.
// - `quiet` ends a run that had nothing to report.
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
  // Only creates tables, so no foreign-key pause and no vacuum. No routine has a destination yet, so every
  // routine keeps its answers in OpenBot, which is what it did before.
  up: (db) => db.exec(ROUTINE_RESULT_SCHEMA_SQL),
};
