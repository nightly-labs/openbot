// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves a table or its
// marker; a newer or incomplete history is accepted; a destination or a delivery can point to no routine,
// run or connection; a deleted routine or run leaves its destination or deliveries behind; a connection
// with a destination can be deleted; a delivery takes a status that the runtime does not know. These
// fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const RESULT_TABLES = {
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
};

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

/** A Slack connection, from schema 25 on. */
function seedConnection(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_messaging_connections
    (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
     last_error_code, created_at, updated_at)
    VALUES ('connection-1', 'slack', 'T1', 'Workspace 界"\\', 1, 'UBOT', 'A1', 'chief', NULL,
      '2026-01-01', '2026-01-01')`).run();
}

/** An agent routine with a succeeded run, in the columns every release has. */
function seed(db: DatabaseSync, version: number): void {
  const stamp = "2026-10-01T07:00:00.000Z";
  db.prepare(`INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone,
      created_at, updated_at, last_event_sequence)
    VALUES ('routine-1', 'chief', 'Morning brief 界', 'Collect the news.', 1, 'Europe/Warsaw', ?, ?, 1)`).run(
    stamp,
    stamp,
  );
  db.prepare(`INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
      routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
    VALUES ('run-1', 'routine-1', 'chief', NULL, 'manual', ?, 'Morning brief 界', 'Collect the news.', 'delivery-1',
      'succeeded', NULL, ?, ?, 2)`).run(stamp, stamp, stamp);
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

function resultTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'routine_result%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

function insertDestination(db: DatabaseSync, routineId: string, connectionId: string): void {
  db.prepare(`INSERT INTO routine_result_destinations
    (routine_id, connection_id, platform, connection_name, place_id, place_name, updated_at)
    VALUES (?, ?, 'slack', 'Workspace', 'C1', 'general', '2026-10-01')`).run(routineId, connectionId);
}

function insertDelivery(db: DatabaseSync, runId: string, status: string): void {
  db.prepare(`INSERT INTO routine_result_deliveries
    (run_id, routine_id, agent_id, connection_id, platform, connection_name, place_id, place_name, text, status,
     created_at, updated_at)
    VALUES (?, 'routine-1', 'chief', 'connection-1', 'slack', 'Workspace', 'C1', 'general', 'The news.', ?,
      '2026-10-01', '2026-10-01')`).run(runId, status);
}

describe("routine result migration", () => {
  it.each(Array.from({ length: 29 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // The earlier migrations run first; the rows after them are what v37 must keep.
      if (version < 36) migrateUpTo(db, 36);
      if (version < 25) seedConnection(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...RESULT_TABLES });
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(36);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=37
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 37 failed");
    expect(contents(db)).toEqual(before);
    expect(resultTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=37").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...RESULT_TABLES });
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAtWithSeed(36);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(48,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=48; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(resultTables(db)).toEqual([]);
  });

  it("refuses rows of no routine, run or connection, and keeps a connection that has a destination", () => {
    const db = databaseAtWithSeed(36);
    migrateOpenBotDatabase(db);
    expect(() => insertDestination(db, "routine-unknown", "connection-1")).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertDestination(db, "routine-1", "connection-unknown")).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertDelivery(db, "run-unknown", "pending")).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertDelivery(db, "run-1", "delivered")).toThrow("CHECK constraint failed");
    insertDestination(db, "routine-1", "connection-1");
    insertDelivery(db, "run-1", "sent");
    expect(() =>
      db.prepare("DELETE FROM projection_messaging_connections WHERE connection_id='connection-1'").run(),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(db.prepare("SELECT routine_id FROM routine_result_destinations").all()).toEqual([
      { routine_id: "routine-1" },
    ]);
  });

  it("deletes the deliveries of a deleted run and the destination of a deleted routine", () => {
    const db = databaseAtWithSeed(36);
    migrateOpenBotDatabase(db);
    insertDestination(db, "routine-1", "connection-1");
    insertDelivery(db, "run-1", "sent");
    db.prepare("DELETE FROM projection_routine_runs WHERE run_id='run-1'").run();
    expect(db.prepare("SELECT run_id FROM routine_result_deliveries").all()).toEqual([]);
    expect(db.prepare("SELECT routine_id FROM routine_result_destinations").all()).toEqual([
      { routine_id: "routine-1" },
    ]);
    db.prepare("DELETE FROM projection_agent_routines WHERE routine_id='routine-1'").run();
    expect(db.prepare("SELECT routine_id FROM routine_result_destinations").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
