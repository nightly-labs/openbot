import type { DatabaseSync } from "node:sqlite";

// Migration v52: Telegram triggers of workflows. The text below is the migration; the latest schema takes
// the run source line of migration 53, so do not edit it after release.
//
// `workflow_runs` gets `telegram` in its source CHECK. SQLite cannot change a CHECK in place, so the
// migration rebuilds the table, as migrations 49 and 50 did; its rows keep their run ids, so the steps,
// output deliveries and GitHub rows that point to them stay as they are. A Telegram trigger has no table
// of its own: the run payload keeps the message that started it, and a Telegram output's post or
// reaction is a row of `workflow_output_deliveries`.
const V52_WORKFLOW_RUN_SOURCE_SQL =
  "source TEXT NOT NULL CHECK(source IN ('manual', 'schedule', 'webhook', 'github', 'discord', 'telegram')),";

const V52_WORKFLOW_RUN_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs(workflow_id, started_at DESC, run_id);
  CREATE INDEX IF NOT EXISTS workflow_runs_open
    ON workflow_runs(status) WHERE status IN ('running', 'approval', 'stopping');
`;

/**
 * Migration 52. The caller pauses foreign keys: the old table is dropped while steps point to its runs,
 * and the new one takes its name and every run id.
 */
export function addTelegramWorkflows(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE workflow_runs_v52 (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
      number INTEGER NOT NULL CHECK(number >= 1),
      trigger_node_id TEXT,
      from_node_id TEXT,
      ${V52_WORKFLOW_RUN_SOURCE_SQL}
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
    INSERT INTO workflow_runs_v52 (
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    ) SELECT
      run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, idempotency_key,
      graph_revision, graph_json, payload, status, error, started_at, ended_at, updated_at
    FROM workflow_runs;
    DROP TABLE workflow_runs;
    ALTER TABLE workflow_runs_v52 RENAME TO workflow_runs;
  `);
  db.exec(V52_WORKFLOW_RUN_INDEXES_SQL);
}
