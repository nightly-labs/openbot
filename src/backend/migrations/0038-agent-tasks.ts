import type { OpenBotMigration } from "./migration";

const AGENT_TASK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_tasks (
    task_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    origin TEXT NOT NULL CHECK(origin IN ('user', 'agent')),
    title TEXT NOT NULL,
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('completed', 'failed', 'interrupted')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    last_event_sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_tasks_agent ON projection_agent_tasks(agent_id, created_at DESC);
`;

export const migration: OpenBotMigration = {
  version: 38,
  name: "agent-tasks",
  up: (db) => db.exec(AGENT_TASK_SCHEMA_SQL),
};
