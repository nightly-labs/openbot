// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table
// or its marker; a newer or incomplete history is accepted; a deleted routine deletes its waits
// or leaves a broken reference. These fixtures cover each.
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

function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_agent_routines
    (routine_id, agent_id, name, instruction, active, timezone, created_at, updated_at, last_event_sequence)
    VALUES ('routine-1', 'chief', 'Nightly build', 'Check the build. 界"\\', 1, 'UTC', '2026-01-01', '2026-01-01', 1)`).run();
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'The build runs at night.', 'the build runs at night.', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
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

function waitTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'agent_waits%' ORDER BY name").all();
}

describe("agent wait migration", () => {
  it.each(Array.from({ length: 26 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db);
      // The earlier migrations run first; the rows after them are what v34 must keep.
      if (version < 33) migrateUpTo(db, 33);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({
        ...before,
        agent_waits: [],
        projection_messaging_memories: [],
        routine_result_deliveries: [],
        routine_result_destinations: [],

        projection_agent_threads: [],
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
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 49 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(33);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=34
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 34 failed");
    expect(contents(db)).toEqual(before);
    expect(waitTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=34").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({
      ...before,
      agent_waits: [],
      projection_messaging_memories: [],
      routine_result_deliveries: [],
      routine_result_destinations: [],

      projection_agent_threads: [],
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
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAtWithSeed(33);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(50,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=50; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(waitTables(db)).toEqual([]);
  });

  it("keeps a wait when its routine is deleted, and leaves it to any routine run", () => {
    const db = databaseAtWithSeed(33);
    migrateOpenBotDatabase(db);
    db.prepare(`INSERT INTO agent_waits
      (wait_id, agent_id, request_delivery_id, request_text, note, routine_id, created_at)
      VALUES ('wait-1', 'chief', 'delivery-1', 'Ship it.', 'Build', 'routine-1', '2026-01-02')`).run();
    db.prepare("DELETE FROM projection_agent_routines WHERE routine_id='routine-1'").run();
    expect(db.prepare("SELECT wait_id, routine_id FROM agent_waits").all()).toEqual([
      { wait_id: "wait-1", routine_id: null },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db);
  return db;
}
