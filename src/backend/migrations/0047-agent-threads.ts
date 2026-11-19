import type { OpenBotMigration } from "./migration";

// The table as migration 47 created it. Frozen: migration 47 runs it, and a change here would change
// what that shipped migration does.
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

// Migration 47. Every task becomes a side thread with the same thread, title, state and dates: a closed
// task is an archived thread. The task id stays as `legacy_task_id`, so a queued mailbox message and a
// Team API client that name the task still find it. A task row whose thread is gone (written while
// foreign keys were off) is not copied: it has no conversation, and copying it would fail the foreign
// key check and stop the app at startup. The task table is a leaf, so it is dropped with no rebuild.
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
  // Copies every task into the side-thread table and drops the task table. No table is rebuilt and the
  // dropped table is a leaf, so no foreign-key pause; few rows, so no vacuum. Mailbox records keep their
  // task ids: the thread keeps the task id as `legacy_task_id`.
  up: (db) => db.exec(AGENT_THREAD_MIGRATION_SQL),
};
