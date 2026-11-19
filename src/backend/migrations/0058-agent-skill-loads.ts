import type { OpenBotMigration } from "./migration";

export const AGENT_SKILL_LOADS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_usage_skill_loads (
    agent_id TEXT NOT NULL,
    load_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    skill TEXT NOT NULL CHECK(length(skill) BETWEEN 1 AND 128),
    tokens INTEGER CHECK(tokens IS NULL OR tokens >= 0),
    estimated_cost_usd REAL CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
    occurred_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, load_id)
  );
  CREATE INDEX IF NOT EXISTS agent_usage_skill_loads_date ON agent_usage_skill_loads(agent_id, occurred_at);
  CREATE INDEX IF NOT EXISTS agent_usage_skill_loads_occurred ON agent_usage_skill_loads(occurred_at);
`;

export const migration: OpenBotMigration = {
  version: 58,
  name: "agent-skill-loads",
  up: (db) => db.exec(AGENT_SKILL_LOADS_SCHEMA_SQL),
};
