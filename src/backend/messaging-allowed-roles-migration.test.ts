// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table
// or its marker; a newer or incomplete history is accepted; a role can point to no connection; a
// connection with roles can be deleted and leave them behind. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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

/** A Discord connection with a link, the rows that migration 44 must keep, from schema 25 on. */
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
  if (version >= 36)
    db.prepare(`INSERT INTO projection_messaging_memories
      (memory_id, connection_id, text, normalized_text, origin, source_turn_id, created_at, updated_at,
       last_event_sequence)
      VALUES ('fact-1', 'connection-1', 'Ana owns the release.', 'ana owns the release.', 'manual', NULL,
        '2026-01-02', '2026-01-02', 3)`).run();
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

function roleTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%messaging_allowed_roles%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 49 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("messaging allowed roles migration", () => {
  it.each(Array.from({ length: 36 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v44 must keep.
      if (version < 43) migrateUpTo(db, 43);
      if (version < 25) seedConnection(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({
        ...before,
        projection_messaging_allowed_roles: [],
        browser_profiles: [],
        workflow_edges: [],
        workflow_github_actions: [],
        workflow_github_deliveries: [],
        workflow_github_runs: [],
        workflow_nodes: [],
        workflow_output_deliveries: [],
        workflow_runs: [],
        workflow_steps: [],
        workflow_trigger_webhooks: [],
        workflow_triggers: [],
        workflow_versions: [],
        workflow_webhook_receipts: [],
        workflows: [],
      });
      expectHealthy(db);
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(43);
    seed(db, 43);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=44
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 44 failed");
    expect(contents(db)).toEqual(before);
    expect(roleTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=44").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({
      ...before,
      projection_messaging_allowed_roles: [],
      browser_profiles: [],
      workflow_edges: [],
      workflow_github_actions: [],
      workflow_github_deliveries: [],
      workflow_github_runs: [],
      workflow_nodes: [],
      workflow_output_deliveries: [],
      workflow_runs: [],
      workflow_steps: [],
      workflow_trigger_webhooks: [],
      workflow_triggers: [],
      workflow_versions: [],
      workflow_webhook_receipts: [],
      workflows: [],
    });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(43);
    seed(db, 43);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(50,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=50; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(roleTables(db)).toEqual([]);
  });

  it("refuses a role of no connection, and keeps a connection that has roles", () => {
    const db = databaseAt(43);
    seed(db, 43);
    migrateOpenBotDatabase(db);
    const insert = db.prepare(`INSERT INTO projection_messaging_allowed_roles
      (connection_id, role_id, role_name, created_at) VALUES (?, '400', 'Maintainers', '2026-01-03')`);
    expect(() => insert.run("connection-unknown")).toThrow("FOREIGN KEY constraint failed");
    insert.run("connection-1");
    expect(() => insert.run("connection-1")).toThrow("UNIQUE constraint failed");
    expect(() =>
      db.prepare("DELETE FROM projection_messaging_connections WHERE connection_id='connection-1'").run(),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(db.prepare("SELECT role_id, role_name FROM projection_messaging_allowed_roles").all()).toEqual([
      { role_id: "400", role_name: "Maintainers" },
    ]);
  });
});
