import type { OpenBotMigration } from "./migration";

const V47_AGENT_THREAD_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_threads (
    thread_id TEXT PRIMARY KEY REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    legacy_task_id TEXT UNIQUE,
    origin TEXT NOT NULL CHECK(origin IN ('user', 'agent')),
    title TEXT NOT NULL,
    title_source TEXT NOT NULL CHECK(title_source IN ('auto', 'agent', 'user')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('completed', 'failed', 'interrupted')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    last_event_sequence INTEGER NOT NULL
  );
`;

export const AGENT_THREAD_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_threads_open ON projection_agent_threads(agent_id, updated_at DESC)
    WHERE archived_at IS NULL;
  CREATE INDEX IF NOT EXISTS agent_threads_agent ON projection_agent_threads(agent_id, created_at DESC);
`;

const AGENT_THREAD_MIGRATION_SQL = `
  ${V47_AGENT_THREAD_TABLE_SQL}
  ${AGENT_THREAD_INDEX_SQL}
  INSERT INTO projection_agent_threads
    (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
     archived_at, last_event_sequence)
  SELECT task.thread_id, task.agent_id, task.task_id, task.origin, task.title,
    CASE task.origin WHEN 'agent' THEN 'agent' ELSE 'auto' END,
    task.outcome, task.error, task.created_at, task.updated_at, task.closed_at, task.last_event_sequence
  FROM projection_agent_tasks AS task
  WHERE task.thread_id IN (SELECT thread_id FROM projection_threads);
  DROP INDEX IF EXISTS agent_tasks_agent;
  DROP TABLE projection_agent_tasks;
`;

export const migration: OpenBotMigration = {
  version: 47,
  name: "agent-threads",
  up: (db) => db.exec(AGENT_THREAD_MIGRATION_SQL),
};
