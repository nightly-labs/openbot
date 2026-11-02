// Shared by migration v46 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// A workflow is a graph that the user draws on the Workflows page: trigger, prompt, model, agent,
// condition, approval and output steps, joined by typed edges. The rows are written directly, not
// through `database.dispatch`: a step holds the text one step gave another, and the event log is
// never deleted from.
//
// Agent ids carry no foreign key, as in every other table keyed by an agent: `hardDeleteAgent`
// clears the agent of a node by hand and keeps the step history.
//
// `workflows`: one graph. `graph_revision` goes up on each saved change; a save names the revision
// it started from, so a stale editor gets a conflict instead of overwriting newer work.
// `strokes_json` holds the freehand drawing, which no step reads. `next_run_number` numbers runs.
//
// `workflow_nodes` and `workflow_edges`: the graph. `position` keeps the order the editor sent, and
// the order of a node's incoming edges is the order of its inputs. `fields_json` holds the node's
// fields; `schedule_json` is set only on a schedule trigger. `branch` is set only on an edge out of a
// condition.
//
// `workflow_versions`: graph snapshots for the version history. `kind` is `auto` for a save, `restore`
// for the state before a restore, and `run` for the graph a run started from.
//
// `workflow_triggers`: one row per trigger node. `next_due_at` is the next schedule occurrence.
// `workflow_trigger_webhooks` holds the relay
// route of a webhook trigger; a removed route goes to `projection_webhook_route_revocations`.
// `workflow_webhook_receipts` records each received delivery once, so a repeat is a no-op. An ignored
// delivery is `busy` (a run was open) or `refused` (the run could not start).
//
// `workflow_runs`: one run. `trigger_node_id` is null for a run the user started without a trigger.
// `graph_json` is the graph the run started from, so an edit during the run does not change it.
// `idempotency_key` is the request id of a manual run, or `workflow:<node>:<scheduled for>` and
// `webhook:<node>:<delivery>` for the others. It is unique in its workflow only, so a copy of a
// workflow, which keeps the node ids, starts its own runs.
//
// `workflow_steps`: one attempt of one step node. `run_id` is null for a step the user ran alone.
// `delivery_id` and `turn_id` belong to an agent step, whose answer comes from that turn.
//
// `workflow_output_deliveries`: one output step's post to a messaging place, with the same status
// machine as `routine_result_deliveries`: `sending` is set before the post, and a restart finds it
// `uncertain`.
export const WORKFLOW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workflows (
    workflow_id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
    graph_revision INTEGER NOT NULL DEFAULT 0 CHECK(graph_revision >= 0),
    strokes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(strokes_json)),
    next_run_number INTEGER NOT NULL DEFAULT 1 CHECK(next_run_number >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workflow_nodes (
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    kind TEXT NOT NULL CHECK(kind IN ('text', 'prompt', 'asset', 'llm', 'agent', 'image', 'trigger', 'condition',
      'approval', 'output', 'note', 'shape')),
    agent_id TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL,
    height REAL,
    font REAL,
    locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0, 1)),
    fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
    schedule_json TEXT CHECK(schedule_json IS NULL OR (kind = 'trigger' AND json_valid(schedule_json))),
    PRIMARY KEY(workflow_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS workflow_nodes_agent ON workflow_nodes(agent_id) WHERE agent_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS workflow_edges (
    workflow_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    port_type TEXT NOT NULL CHECK(port_type IN ('text', 'image', 'file')),
    branch TEXT CHECK(branch IS NULL OR branch IN ('yes', 'no')),
    CHECK(from_node_id <> to_node_id),
    PRIMARY KEY(workflow_id, edge_id),
    FOREIGN KEY(workflow_id, from_node_id) REFERENCES workflow_nodes(workflow_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY(workflow_id, to_node_id) REFERENCES workflow_nodes(workflow_id, node_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS workflow_edges_from ON workflow_edges(workflow_id, from_node_id);
  CREATE INDEX IF NOT EXISTS workflow_edges_to ON workflow_edges(workflow_id, to_node_id);
  CREATE TABLE IF NOT EXISTS workflow_versions (
    version_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    graph_revision INTEGER NOT NULL CHECK(graph_revision >= 0),
    kind TEXT NOT NULL CHECK(kind IN ('auto', 'restore', 'run')),
    graph_json TEXT NOT NULL CHECK(json_valid(graph_json)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_versions_recent ON workflow_versions(workflow_id, created_at DESC, version_id);
  CREATE TABLE IF NOT EXISTS workflow_triggers (
    workflow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('manual', 'schedule', 'webhook')),
    timezone TEXT,
    schedule_json TEXT CHECK(schedule_json IS NULL OR json_valid(schedule_json)),
    next_due_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workflow_id, node_id),
    FOREIGN KEY(workflow_id, node_id) REFERENCES workflow_nodes(workflow_id, node_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS workflow_triggers_due
    ON workflow_triggers(next_due_at) WHERE next_due_at IS NOT NULL;
  CREATE TABLE IF NOT EXISTS workflow_trigger_webhooks (
    workflow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    route_id TEXT NOT NULL UNIQUE,
    secret_ciphertext TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workflow_id, node_id),
    FOREIGN KEY(workflow_id, node_id) REFERENCES workflow_triggers(workflow_id, node_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS workflow_webhook_receipts (
    receipt_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('started', 'ignored')),
    reason TEXT CHECK(reason IS NULL OR reason IN ('busy', 'refused')),
    run_id TEXT,
    received_at TEXT NOT NULL,
    UNIQUE(workflow_id, node_id, delivery_id)
  );
  CREATE INDEX IF NOT EXISTS workflow_webhook_receipts_received ON workflow_webhook_receipts(received_at);
  CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number >= 1),
    trigger_node_id TEXT,
    from_node_id TEXT,
    source TEXT NOT NULL CHECK(source IN ('manual', 'schedule', 'webhook')),
    scheduled_for TEXT,
    idempotency_key TEXT NOT NULL,
    graph_revision INTEGER NOT NULL CHECK(graph_revision >= 0),
    graph_json TEXT NOT NULL CHECK(json_valid(graph_json)),
    payload TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'approval', 'stopping', 'done', 'failed', 'stopped')),
    error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(workflow_id, number),
    UNIQUE(workflow_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow_id, started_at DESC, run_id);
  CREATE INDEX IF NOT EXISTS workflow_runs_open
    ON workflow_runs(status) WHERE status IN ('running', 'approval', 'stopping');
  CREATE TABLE IF NOT EXISTS workflow_steps (
    step_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    run_id TEXT REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK(attempt >= 1),
    request_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('prompt', 'asset', 'llm', 'agent', 'image', 'trigger', 'condition', 'approval',
      'output')),
    agent_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'approval', 'done', 'failed', 'stopped', 'skipped')),
    delivery_id TEXT,
    turn_id TEXT,
    input TEXT NOT NULL DEFAULT '',
    output TEXT,
    branch TEXT CHECK(branch IS NULL OR branch IN ('yes', 'no')),
    error TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workflow_id, request_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_attempt
    ON workflow_steps(run_id, node_id, attempt) WHERE run_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_delivery
    ON workflow_steps(delivery_id) WHERE delivery_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS workflow_steps_solo
    ON workflow_steps(workflow_id, created_at DESC, step_id) WHERE run_id IS NULL;
  CREATE INDEX IF NOT EXISTS workflow_steps_open
    ON workflow_steps(status) WHERE status IN ('running', 'approval');
  CREATE INDEX IF NOT EXISTS workflow_steps_agent ON workflow_steps(agent_id) WHERE agent_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS workflow_output_deliveries (
    step_id TEXT PRIMARY KEY REFERENCES workflow_steps(step_id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    place_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
