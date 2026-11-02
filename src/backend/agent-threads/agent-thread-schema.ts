// The tail of the latest schema for new databases. IF NOT EXISTS throughout, as the other schema parts.
//
// A side thread is a second conversation of one agent that runs next to its own chat: the agent keeps
// its identity, workspace and memories, and the thread has a provider session of its own. The agent's
// own chat (`projection_agents.thread_id`) has no row here.
//
// `projection_agent_threads`: one row for each side thread. Deleting the thread deletes the row.
// `legacy_task_id` is the id of a task from before migration 47; mailbox records and Team API clients
// still name the thread by it. It is null for a thread created after 47. `origin` says who started it:
// the person, or the agent with its `start_task` tool. `title_source` says where the title came from:
// the first message (`auto`), the agent's `start_task` call (`agent`), or a rename (`user`). `outcome`
// is the end of the last turn, null before its first turn ends. `error` is the redacted provider error
// of the last failed turn; a new turn clears it. `archived_at` is set when the person or the agent
// archives the thread; an archived thread takes no message until it is restored.
//
// The title lives only here: the roster rewrites `projection_threads.title` to the agent name.
//
// The `branch_*` columns (migration 48) link a branch to the place it was copied from: the source thread
// (the agent's own chat or a side thread), the message the person chose there, and the last copied row
// in the branch. They have no foreign key, because the branch outlives its source. All three are null
// for a thread that is not a branch, or all three are set; the store keeps that rule. They are at the
// end of the column list, where migration 48 adds them, so a new database and an upgraded one match.

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

const AGENT_THREAD_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS agent_threads_open ON projection_agent_threads(agent_id, updated_at DESC)
    WHERE archived_at IS NULL;
  CREATE INDEX IF NOT EXISTS agent_threads_agent ON projection_agent_threads(agent_id, created_at DESC);
`;

// The latest table, for new databases.
export const AGENT_THREAD_SCHEMA_SQL = `
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
    last_event_sequence INTEGER NOT NULL,
    branch_source_thread_id TEXT,
    branch_source_message_id TEXT,
    branch_through_message_id TEXT
  );
  ${AGENT_THREAD_INDEX_SQL}
`;

// Migration 47. Every task becomes a side thread with the same thread, title, state and dates: a closed
// task is an archived thread. The task id stays as `legacy_task_id`, so a queued mailbox message and a
// Team API client that name the task still find it. A task row whose thread is gone (written while
// foreign keys were off) is not copied: it has no conversation, and copying it would fail the foreign
// key check and stop the app at startup. The task table is a leaf, so it is dropped with no rebuild.
export const AGENT_THREAD_MIGRATION_SQL = `
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

// Migration 48. The branch link, added with no default: no rebuild, no data change, and every existing
// thread gets null, which is a thread that is not a branch.
export const V48_AGENT_THREAD_BRANCH_COLUMNS_SQL = [
  "branch_source_thread_id TEXT",
  "branch_source_message_id TEXT",
  "branch_through_message_id TEXT",
] as const;
