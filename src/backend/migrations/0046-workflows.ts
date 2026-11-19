import type { OpenBotMigration } from "./migration";

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

export const V46_WORKFLOW_RUN_SOURCE_SQL = "source TEXT NOT NULL CHECK(source IN ('manual', 'schedule', 'webhook')),";

export const migration: OpenBotMigration = {
  version: 46,
  name: "workflows",
  up: (db) => db.exec(WORKFLOW_SCHEMA_SQL),
};
