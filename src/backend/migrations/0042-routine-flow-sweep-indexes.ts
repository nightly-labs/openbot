import type { OpenBotMigration } from "./migration";

// Migration 42 indexes the columns that a routine flow sweep filters on. A sweep runs on each turn and queue
// change, and without them each one is a scan of every routine run and flow step (#2283). The running steps
// index holds only running steps, in the order the sweep reads them. Frozen with the migration.
export const V42_ROUTINE_FLOW_SWEEP_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS routine_runs_status_updated ON projection_routine_runs(status, updated_at);
  CREATE INDEX IF NOT EXISTS routine_flow_steps_running ON routine_flow_steps(created_at, step_id)
    WHERE status = 'running';
  CREATE INDEX IF NOT EXISTS routine_flow_steps_updated ON routine_flow_steps(updated_at);
`;

export const migration: OpenBotMigration = {
  version: 42,
  name: "routine-flow-sweep-indexes",
  // Only creates indexes, so no foreign-key pause and no vacuum.
  up: (db) => db.exec(V42_ROUTINE_FLOW_SWEEP_INDEX_SQL),
};
