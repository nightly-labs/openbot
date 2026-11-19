import type { OpenBotMigration } from "./migration";

export const V42_ROUTINE_FLOW_SWEEP_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS routine_runs_status_updated ON projection_routine_runs(status, updated_at);
  CREATE INDEX IF NOT EXISTS routine_flow_steps_running ON routine_flow_steps(created_at, step_id)
    WHERE status = 'running';
  CREATE INDEX IF NOT EXISTS routine_flow_steps_updated ON routine_flow_steps(updated_at);
`;

export const migration: OpenBotMigration = {
  version: 42,
  name: "routine-flow-sweep-indexes",
  up: (db) => db.exec(V42_ROUTINE_FLOW_SWEEP_INDEX_SQL),
};
