// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table
// or its marker; a newer or incomplete history is accepted; a memory can point to no connection; a
// connection with memories can be deleted and leave them behind. These fixtures cover each.
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

/** A Slack connection with a link, the rows that migration 36 must keep, from schema 25 on. */
function seedConnection(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_messaging_connections
    (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
     last_error_code, created_at, updated_at)
    VALUES ('connection-1', 'slack', 'T1', 'Workspace 界"\\', 1, 'UBOT', 'A1', 'chief', NULL,
      '2026-01-01', '2026-01-01')`).run();
}

function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'The build runs at night.', 'the build runs at night.', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 25) seedConnection(db);
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function memoryTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%messaging_memories%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

describe("messaging memory migration", () => {
  it.each(Array.from({ length: 28 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // The earlier migrations run first; the rows after them are what v36 must keep.
      if (version < 35) migrateUpTo(db, 35);
      if (version < 25) seedConnection(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({
        ...before,
        projection_messaging_memories: [],
        routine_result_deliveries: [],
        routine_result_destinations: [],

        projection_agent_threads: [],
        projection_messaging_allowed_roles: [],
        browser_profiles: [],
        workflow_edges: [],
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
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(35);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=36
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 36 failed");
    expect(contents(db)).toEqual(before);
    expect(memoryTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=36").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({
      ...before,
      projection_messaging_memories: [],
      routine_result_deliveries: [],
      routine_result_destinations: [],

      projection_agent_threads: [],
      projection_messaging_allowed_roles: [],
      browser_profiles: [],
      workflow_edges: [],
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
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAtWithSeed(35);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(48,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=48; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(memoryTables(db)).toEqual([]);
  });

  it("refuses a memory of no connection, and keeps a connection that has memories", () => {
    const db = databaseAtWithSeed(35);
    migrateOpenBotDatabase(db);
    const insert = db.prepare(`INSERT INTO projection_messaging_memories
      (memory_id, connection_id, text, normalized_text, origin, source_turn_id, created_at, updated_at,
       last_event_sequence)
      VALUES (?, ?, 'Bob owns the release.', 'Bob owns the release.', 'automatic', 'turn-1', '2026-01-02',
        '2026-01-02', 3)`);
    expect(() => insert.run("memory-x", "connection-unknown")).toThrow("FOREIGN KEY constraint failed");
    insert.run("memory-1", "connection-1");
    expect(() =>
      db.prepare("DELETE FROM projection_messaging_connections WHERE connection_id='connection-1'").run(),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(db.prepare("SELECT memory_id FROM projection_messaging_memories").all()).toEqual([
      { memory_id: "memory-1" },
    ]);
  });
});
