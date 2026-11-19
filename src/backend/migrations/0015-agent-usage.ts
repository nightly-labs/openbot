import type { OpenBotMigration } from "./migration";

export const ANALYTICS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_usage_records (
    agent_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    tokens_json TEXT NOT NULL CHECK(json_valid(tokens_json)),
    estimated_cost_usd REAL,
    rate_basis TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, record_id)
  );
  CREATE INDEX IF NOT EXISTS agent_usage_date ON agent_usage_records(agent_id, occurred_at);
  CREATE TABLE IF NOT EXISTS agent_usage_checkpoints (
    agent_id TEXT NOT NULL,
    counter_id TEXT NOT NULL,
    tokens_json TEXT NOT NULL CHECK(json_valid(tokens_json)),
    PRIMARY KEY(agent_id, counter_id)
  );
  CREATE TABLE IF NOT EXISTS agent_usage_activity (
    agent_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('turn', 'user', 'assistant')),
    occurred_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, activity_id)
  );
  CREATE INDEX IF NOT EXISTS agent_usage_activity_date ON agent_usage_activity(agent_id, occurred_at);
`;

export const migration: OpenBotMigration = {
  version: 15,
  name: "agent-usage",
  up: (db) => db.exec(ANALYTICS_SCHEMA_SQL),
};
