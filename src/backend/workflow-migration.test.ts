// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves a table or
// its marker; a newer or incomplete history is accepted; an edge, trigger, step or delivery can point
// to nothing; deleting a workflow leaves its rows behind; deleting a node leaves its edges and trigger.
// These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const WORKFLOW_TABLES = [
  "workflow_edges",
  "workflow_nodes",
  "workflow_output_deliveries",
  "workflow_runs",
  "workflow_steps",
  "workflow_trigger_webhooks",
  "workflow_triggers",
  "workflow_versions",
  "workflow_webhook_receipts",
  "workflows",
];
const EMPTY_WORKFLOW_TABLES = Object.fromEntries(WORKFLOW_TABLES.map((table) => [table, []]));

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

/** A Discord connection, the place an output step posts to, from schema 25 on. */
function seedConnection(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_messaging_connections
    (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
     last_error_code, created_at, updated_at)
    VALUES ('connection-1', 'discord', '100000000000000001', 'Server 界"\\', 1, '200', '300', 'chief', NULL,
      '2026-01-01', '2026-01-01')`).run();
}

function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'The build runs at night.', 'the build runs at night.', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 25) seedConnection(db);
  if (version >= 44)
    db.prepare(`INSERT INTO projection_messaging_allowed_roles (connection_id, role_id, role_name, created_at)
      VALUES ('connection-1', '400', 'Maintainers', '2026-01-02')`).run();
  if (version >= 45)
    db.prepare(`INSERT INTO browser_profiles (profile_id, name, hue, created_at, updated_at)
      VALUES ('0123456789abcdef0123456789abcdef', 'Work', 30, '2026-01-02', '2026-01-02')`).run();
}

/**
 * Every row of every table, by table name. Migration 47 replaces the empty task table with the thread
 * table; `agent-thread-migration.test.ts` checks that move.
 */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%'
       AND name NOT IN ('projection_agent_tasks', 'projection_agent_threads') ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function workflowTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'workflow%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

/** One workflow with a trigger, an agent and an output, one run, and a step of each kind of row. */
function seedWorkflow(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO workflows (workflow_id, title, created_at, updated_at)
      VALUES ('workflow-1', 'Competitor watch', '2026-01-03', '2026-01-03');
    INSERT INTO workflow_nodes (workflow_id, node_id, position, kind, agent_id, x, y, fields_json, schedule_json)
      VALUES ('workflow-1', 'trigger', 0, 'trigger', NULL, 0, 0, '{"trigger":"webhook"}', NULL),
             ('workflow-1', 'agent', 1, 'agent', 'chief', 320, 0, '{"agentId":"chief","task":"Read it"}', NULL),
             ('workflow-1', 'output', 2, 'output', NULL, 640, 0, '{"target":"channel"}', NULL);
    INSERT INTO workflow_edges (workflow_id, edge_id, position, from_node_id, to_node_id, port_type)
      VALUES ('workflow-1', 'edge-1', 0, 'trigger', 'agent', 'text'),
             ('workflow-1', 'edge-2', 1, 'agent', 'output', 'text');
    INSERT INTO workflow_triggers (workflow_id, node_id, kind, updated_at)
      VALUES ('workflow-1', 'trigger', 'webhook', '2026-01-03');
    INSERT INTO workflow_trigger_webhooks (workflow_id, node_id, route_id, secret_ciphertext, created_at, updated_at)
      VALUES ('workflow-1', 'trigger', 'route-1', 'ciphertext', '2026-01-03', '2026-01-03');
    INSERT INTO workflow_versions (version_id, workflow_id, graph_revision, kind, graph_json, created_at)
      VALUES ('version-1', 'workflow-1', 0, 'run', '{"nodes":[],"edges":[],"strokes":[]}', '2026-01-03');
    INSERT INTO workflow_runs (run_id, workflow_id, number, trigger_node_id, source, idempotency_key, graph_revision,
        graph_json, status, started_at, updated_at)
      VALUES ('run-1', 'workflow-1', 1, 'trigger', 'webhook', 'webhook:trigger:delivery-1', 0,
        '{"nodes":[],"edges":[],"strokes":[]}', 'running', '2026-01-03', '2026-01-03');
    INSERT INTO workflow_webhook_receipts (receipt_id, workflow_id, node_id, delivery_id, status, run_id, received_at)
      VALUES ('receipt-1', 'workflow-1', 'trigger', 'delivery-1', 'started', 'run-1', '2026-01-03');
    INSERT INTO workflow_steps (step_id, workflow_id, run_id, node_id, attempt, request_id, kind, agent_id, status,
        created_at, updated_at)
      VALUES ('step-1', 'workflow-1', 'run-1', 'output', 1, 'run-1:output:1', 'output', NULL, 'running',
        '2026-01-03', '2026-01-03'),
             ('step-2', 'workflow-1', NULL, 'agent', 1, 'request-2', 'agent', 'chief', 'done',
        '2026-01-03', '2026-01-03');
    INSERT INTO workflow_output_deliveries (step_id, connection_id, place_id, text, status, created_at, updated_at)
      VALUES ('step-1', 'connection-1', 'place-1', 'Answer', 'pending', '2026-01-03', '2026-01-03');
  `);
}

function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count);
}

describe("workflow migration", () => {
  it.each(Array.from({ length: 38 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v46 must keep.
      if (version < 45) migrateUpTo(db, 45);
      if (version < 25) seedConnection(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...EMPTY_WORKFLOW_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(45);
    seed(db, 45);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=46
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 46 failed");
    expect(contents(db)).toEqual(before);
    expect(workflowTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=46").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...EMPTY_WORKFLOW_TABLES });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAt(45);
    seed(db, 45);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(48,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=48; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(workflowTables(db)).toEqual([]);
  });

  it("refuses rows that point to nothing", () => {
    const db = databaseAt(45);
    seed(db, 45);
    migrateOpenBotDatabase(db);
    seedWorkflow(db);
    const fails = (sql: string) => expect(() => db.exec(sql)).toThrow("constraint failed");
    fails(`INSERT INTO workflow_nodes (workflow_id, node_id, position, kind, x, y, fields_json)
      VALUES ('workflow-unknown', 'node', 0, 'prompt', 0, 0, '{}')`);
    fails(`INSERT INTO workflow_edges (workflow_id, edge_id, position, from_node_id, to_node_id, port_type)
      VALUES ('workflow-1', 'edge-3', 2, 'agent', 'node-unknown', 'text')`);
    fails(`INSERT INTO workflow_edges (workflow_id, edge_id, position, from_node_id, to_node_id, port_type)
      VALUES ('workflow-1', 'edge-3', 2, 'agent', 'agent', 'text')`);
    fails(`INSERT INTO workflow_triggers (workflow_id, node_id, kind, updated_at)
      VALUES ('workflow-1', 'node-unknown', 'manual', '2026-01-03')`);
    fails(`INSERT INTO workflow_output_deliveries (step_id, connection_id, place_id, text, status, created_at, updated_at)
      VALUES ('step-2', 'connection-unknown', 'place-1', 'Answer', 'pending', '2026-01-03', '2026-01-03')`);
    fails(`INSERT INTO workflow_nodes (workflow_id, node_id, position, kind, x, y, fields_json, schedule_json)
      VALUES ('workflow-1', 'prompt', 3, 'prompt', 0, 0, '{}', '{"type":"daily"}')`);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("removes the edges and trigger of a deleted node, and every row of a deleted workflow", () => {
    const db = databaseAt(45);
    seed(db, 45);
    migrateOpenBotDatabase(db);
    seedWorkflow(db);
    db.exec("DELETE FROM workflow_nodes WHERE workflow_id='workflow-1' AND node_id='trigger'");
    expect(db.prepare("SELECT edge_id FROM workflow_edges").all()).toEqual([{ edge_id: "edge-2" }]);
    expect(count(db, "workflow_triggers")).toBe(0);
    expect(count(db, "workflow_trigger_webhooks")).toBe(0);
    expect(count(db, "workflow_runs")).toBe(1);

    db.exec("DELETE FROM workflows WHERE workflow_id='workflow-1'");
    for (const table of WORKFLOW_TABLES) expect(count(db, table)).toBe(0);
    expect(count(db, "projection_messaging_connections")).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps run and step keys unique in one workflow only, and refuses a step of an annotation", () => {
    const db = databaseAt(45);
    seed(db, 45);
    migrateOpenBotDatabase(db);
    seedWorkflow(db);
    // A copy keeps the node ids, so its keys are the same text as the first workflow's.
    db.exec(`INSERT INTO workflows (workflow_id, title, created_at, updated_at)
      VALUES ('workflow-2', 'Competitor watch copy', '2026-01-04', '2026-01-04')`);
    const run = (workflowId: string, runId: string, number: number) =>
      `INSERT INTO workflow_runs (run_id, workflow_id, number, source, idempotency_key, graph_revision, graph_json,
          status, started_at, updated_at)
        VALUES ('${runId}', '${workflowId}', ${number}, 'webhook', 'webhook:trigger:delivery-1', 0,
          '{"nodes":[],"edges":[],"strokes":[]}', 'running', '2026-01-04', '2026-01-04')`;
    const step = (workflowId: string, stepId: string, kind: string) =>
      `INSERT INTO workflow_steps (step_id, workflow_id, node_id, attempt, request_id, kind, status, created_at, updated_at)
        VALUES ('${stepId}', '${workflowId}', 'agent', 1, 'request-2', '${kind}', 'done', '2026-01-04', '2026-01-04')`;
    db.exec(run("workflow-2", "run-2", 1));
    db.exec(step("workflow-2", "step-3", "agent"));
    const fails = (sql: string) => expect(() => db.exec(sql)).toThrow("constraint failed");
    fails(run("workflow-1", "run-3", 2));
    fails(step("workflow-1", "step-4", "agent"));
    fails(step("workflow-2", "step-5", "note").replace("request-2", "request-5"));
    fails(step("workflow-2", "step-6", "agent").replace("request-2", "request-6").replace("'done'", "'waiting'"));
    expect(count(db, "workflow_runs")).toBe(2);
    expect(count(db, "workflow_steps")).toBe(3);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
