// Shared by migration v34 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// An open wait is work an agent stopped before it was done, because it waits for something outside
// the turn: a build, a deploy, the next routine run. The agent opens it with `openbot.await_event`,
// lists it with `openbot.list_waits` and closes it with `openbot.close_wait`; another local agent
// can list and close it with `agentId`; the user can cancel it. A closed or cancelled wait is
// deleted, so every row is an open wait.
//
// Agent ids carry no foreign key, as in every other table keyed by an agent: `hardDeleteAgent`
// removes the rows of a deleted agent by hand.
//
// `request_delivery_id` and `request_text` are the message the wait serves, copied when the wait
// opens, so a wake can repeat the request after the transcript is compacted or cleared.
// `routine_id` limits the runs that wake the wait to one routine; absent, any routine run of the
// agent wakes it. A deleted routine leaves the wait to any run. `woken_at` and `wake_delivery_id`
// are the last run that woke the wait: the agent sees the wait in that delivery's input.
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
