import type { OpenBotMigration } from "./migration";

export const AGENT_WAIT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_waits (
    wait_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    request_delivery_id TEXT NOT NULL,
    request_text TEXT NOT NULL,
    note TEXT NOT NULL,
    routine_id TEXT REFERENCES projection_agent_routines(routine_id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    woken_at TEXT,
    wake_delivery_id TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_waits_agent ON agent_waits(agent_id);
  CREATE INDEX IF NOT EXISTS agent_waits_routine ON agent_waits(routine_id) WHERE routine_id IS NOT NULL;
`;

export const migration: OpenBotMigration = {
  version: 34,
  name: "agent-waits",
  up: (db) => db.exec(AGENT_WAIT_SCHEMA_SQL),
};
