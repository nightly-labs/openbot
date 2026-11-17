import { AGENT_THREAD_INDEX_SQL } from "../migrations/0047-agent-threads";
import { V54_AGENT_THREAD_ROUTINE_INDEX_SQL } from "../migrations/0054-agent-thread-routine";

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
//
// `routine_id` (migration 54) names the routine of the agent whose runs go to this thread. Each routine
// has one thread at most, open or archived, so its runs run next to the chat and its earlier runs stay
// in one place. It has no foreign key: routines are not in this database. It is null for every other
// thread.
//
// The migrations 47, 48 and 54 that make this table are in `migrations/`.

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
    branch_through_message_id TEXT,
    routine_id TEXT
  );
  ${AGENT_THREAD_INDEX_SQL}
  ${V54_AGENT_THREAD_ROUTINE_INDEX_SQL}
`;
