import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";

export const V53_WORKFLOW_RUN_SOURCE_SQL =
  "source TEXT NOT NULL CHECK(source IN ('manual', 'schedule', 'webhook', 'github', 'discord', 'telegram', 'slack')),";

const V53_WORKFLOW_RUN_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow_id, started_at DESC, run_id);
  CREATE INDEX IF NOT EXISTS workflow_runs_open
    ON workflow_runs(status) WHERE status IN ('running', 'approval', 'stopping');
`;

function addSlackWorkflows(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE workflow_runs_v53 (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
      number INTEGER NOT NULL CHECK(number >= 1),
      trigger_node_id TEXT,
      from_node_id TEXT,
      ${V53_WORKFLOW_RUN_SOURCE_SQL}
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
    INSERT INTO workflow_runs_v53 (
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    ) SELECT
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    FROM workflow_runs;
    DROP TABLE workflow_runs;
    ALTER TABLE workflow_runs_v53 RENAME TO workflow_runs;
  `);
  db.exec(V53_WORKFLOW_RUN_INDEXES_SQL);
}

export const migration: OpenBotMigration = {
  version: 53,
  name: "slack-workflows",
  disableForeignKeys: true,
  up: addSlackWorkflows,
};
