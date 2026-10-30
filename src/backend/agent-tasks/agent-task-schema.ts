// Migration v38, frozen. Migration 47 moves every task to `projection_agent_threads` and drops this
// table, so the latest schema no longer has it.
//
// A task is a second conversation of one agent that runs next to its own chat: the agent keeps its
// identity, workspace and memories, and the task has a thread and a provider session of its own.
//
// `projection_agent_tasks`: one row for each task. `thread_id` is the task's conversation; deleting
// the thread deletes the task. `origin` says who started it: the person, or the agent with its
// `start_task` tool. `outcome` is the end of the task's last turn, null before its first turn ends. `error` is the redacted provider error of the last failed turn; a new
// turn clears it. `closed_at` is set when the person or the agent closes the task;
// a closed task takes no more messages.
//
// A message that runs in a task carries the task's id in its mailbox record, as a channel message
// carries its channel. A message with no task id runs in the agent's own chat, as before v38.
export const AGENT_TASK_SCHEMA_SQL = `
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
