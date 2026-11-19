import type { OpenBotMigration } from "./migration";

export const ROUTINE_FLOW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS routine_flow_links (
    link_id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES projection_agent_routines(routine_id) ON DELETE CASCADE,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    CHECK(from_agent_id <> to_agent_id),
    UNIQUE(routine_id, from_agent_id, to_agent_id)
  );
  CREATE INDEX IF NOT EXISTS routine_flow_links_to ON routine_flow_links(to_agent_id);
  CREATE TABLE IF NOT EXISTS routine_flow_positions (
    canvas_agent_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(canvas_agent_id, node_key)
  );
  CREATE TABLE IF NOT EXISTS routine_flow_steps (
    step_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES projection_routine_runs(run_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    delivery_id TEXT,
    input TEXT NOT NULL,
    output TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped', 'cancelled')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id, agent_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS routine_flow_steps_delivery
    ON routine_flow_steps(delivery_id) WHERE delivery_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS routine_flow_steps_agent ON routine_flow_steps(agent_id);
`;

export const migration: OpenBotMigration = {
  version: 31,
  name: "routine-flows",
  up: (db) => db.exec(ROUTINE_FLOW_SCHEMA_SQL),
};
