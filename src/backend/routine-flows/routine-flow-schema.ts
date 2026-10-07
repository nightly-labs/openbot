// Shared by migration v28 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// A routine flow is what happens after an agent routine's own agent answers: each link hands that
// answer on to another agent, which answers in turn. The rows are written directly, not through
// `database.dispatch`: a step holds the text one agent gave another, and the event log is never
// deleted from.
//
// Agent ids carry no foreign key, as in every other table keyed by an agent: `hardDeleteAgent`
// removes the rows of a deleted agent by hand.
//
// `routine_flow_links`: one handoff inside one routine. The routine's own agent starts the flow; a
// link from an agent passes that agent's answer to the next one. `instruction` is what the next
// agent is asked to do with it, and may be empty.
//
// `routine_flow_positions`: where a node sits on one agent's canvas. `node_key` is `routine:<id>` or
// `agent:<id>`. A row also places an agent on a canvas before any link reaches it.
//
// `routine_flow_steps`: one agent's part of one run, at most one per agent and run. The routine's
// own agent gets one when its answer is in; every other agent when its input is sent. `delivery_id`
// is the mailbox delivery that carried the input, absent for the routine's own agent, whose
// delivery is the run's.
export const ROUTINE_FLOW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS routine_flow_links (
    link_id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES projection_agent_routines(routine_id) ON DELETE CASCADE,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    CHECK(from_agent_id <> to_agent_id),
    UNIQUE(routine_id, from_agent_id, to_agent_id)
  );
  CREATE INDEX IF NOT EXISTS routine_flow_links_to ON routine_flow_links(to_agent_id);
  CREATE TABLE IF NOT EXISTS routine_flow_positions (
    canvas_agent_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(canvas_agent_id, node_key)
  );
  CREATE TABLE IF NOT EXISTS routine_flow_steps (
    step_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES projection_routine_runs(run_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    delivery_id TEXT,
    input TEXT NOT NULL,
    output TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped', 'cancelled')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id, agent_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS routine_flow_steps_delivery
    ON routine_flow_steps(delivery_id) WHERE delivery_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS routine_flow_steps_agent ON routine_flow_steps(agent_id);
`;
