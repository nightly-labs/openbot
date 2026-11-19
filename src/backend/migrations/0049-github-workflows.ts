import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";

const V49_WORKFLOW_RUN_SOURCE_SQL =
  "source TEXT NOT NULL CHECK(source IN ('manual', 'schedule', 'webhook', 'github')),";

const V49_WORKFLOW_RUN_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow_id, started_at DESC, run_id);
  CREATE INDEX IF NOT EXISTS workflow_runs_open
    ON workflow_runs(status) WHERE status IN ('running', 'approval', 'stopping');
`;

export const WORKFLOW_GITHUB_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workflow_github_runs (
    run_id TEXT PRIMARY KEY REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    delivery_id TEXT,
    repository TEXT NOT NULL,
    number INTEGER NOT NULL CHECK(number >= 1),
    pull_request INTEGER NOT NULL CHECK(pull_request IN (0, 1)),
    title TEXT NOT NULL,
    caused_by_bot INTEGER NOT NULL CHECK(caused_by_bot IN (0, 1)),
    started_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_github_runs_item
    ON workflow_github_runs(repository, number, started_at);
  CREATE INDEX IF NOT EXISTS workflow_github_runs_workflow ON workflow_github_runs(workflow_id);
  CREATE TABLE IF NOT EXISTS workflow_github_deliveries (
    workflow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    event TEXT NOT NULL,
    repository TEXT,
    number INTEGER CHECK(number IS NULL OR number >= 1),
    pull_request INTEGER CHECK(pull_request IS NULL OR pull_request IN (0, 1)),
    title TEXT,
    received_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('started', 'waiting', 'skipped')),
    reason TEXT CHECK(reason IS NULL OR reason IN ('filter', 'self', 'chain', 'offline', 'refused')),
    run_id TEXT,
    payload TEXT,
    caused_by_bot INTEGER NOT NULL DEFAULT 0 CHECK(caused_by_bot IN (0, 1)),
    CHECK((repository IS NULL) = (number IS NULL) AND (number IS NULL) = (pull_request IS NULL)
      AND (number IS NULL) = (title IS NULL)),
    CHECK((outcome = 'skipped') = (reason IS NOT NULL)),
    CHECK(payload IS NULL OR outcome = 'waiting'),
    PRIMARY KEY(workflow_id, node_id, delivery_id),
    FOREIGN KEY(workflow_id, node_id) REFERENCES workflow_nodes(workflow_id, node_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS workflow_github_deliveries_recent
    ON workflow_github_deliveries(workflow_id, node_id, received_at DESC);
  CREATE INDEX IF NOT EXISTS workflow_github_deliveries_waiting
    ON workflow_github_deliveries(workflow_id, repository, number, received_at) WHERE outcome = 'waiting';
  CREATE TABLE IF NOT EXISTS workflow_github_actions (
    action_key TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    run_id TEXT REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    number INTEGER CHECK(number IS NULL OR number >= 1),
    action TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sending', 'done')),
    object_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_github_actions_item ON workflow_github_actions(repository, number, created_at);
  CREATE INDEX IF NOT EXISTS workflow_github_actions_run ON workflow_github_actions(run_id);
`;

function addGitHubWorkflows(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE workflow_runs_v49 (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
      number INTEGER NOT NULL CHECK(number >= 1),
      trigger_node_id TEXT,
      from_node_id TEXT,
      ${V49_WORKFLOW_RUN_SOURCE_SQL}
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
    INSERT INTO workflow_runs_v49 (
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    ) SELECT
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    FROM workflow_runs;
    DROP TABLE workflow_runs;
    ALTER TABLE workflow_runs_v49 RENAME TO workflow_runs;
  `);
  db.exec(V49_WORKFLOW_RUN_INDEXES_SQL);
  db.exec(WORKFLOW_GITHUB_SCHEMA_SQL);
}

export const migration: OpenBotMigration = {
  version: 49,
  name: "github-workflows",
  disableForeignKeys: true,
  up: addGitHubWorkflows,
};
