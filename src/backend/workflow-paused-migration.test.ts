// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as pausedMigration } from "./migrations/0068-workflow-paused";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const SOURCES = Array.from({ length: 22 }, (_, index) => index + 46);

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

function migrateToPaused(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > pausedMigration.version) migrateUpTo(db, pausedMigration.version);
  else migrateOpenBotDatabase(db);
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO workflows (workflow_id, title, graph_revision, created_at, updated_at)
      VALUES ('workflow-1', 'Nightly 界"\\', 3, '2026-03-01', '2026-03-02'),
             ('workflow-2', 'Weekly', 0, '2026-03-03', '2026-03-03');
    INSERT INTO workflow_nodes (workflow_id, node_id, position, kind, fields_json, x, y, width, height)
      VALUES ('workflow-1', 'start', 0, 'trigger', '{"trigger":"schedule","every":"day"}', 0, 0, 240, 120);
    INSERT INTO workflow_triggers (workflow_id, node_id, kind, next_due_at, updated_at)
      VALUES ('workflow-1', 'start', 'schedule', '2026-03-03T09:00:00.000Z', '2026-03-02');
  `);
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function withActiveWorkflows(before: Contents): Contents {
  return { ...before, workflows: (before.workflows ?? []).map((row) => ({ ...row, paused: 0 })) };
}

function columns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(workflows)")
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync, version = pausedMigration.version): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("workflow paused migration", () => {
  it.each(SOURCES)("keeps every row from released schema %i, and every workflow stays active", (version) => {
    const db = databaseAt(version);
    seed(db);
    if (version < 67) migrateUpTo(db, 67);
    const before = contents(db);
    migrateToPaused(db);
    expect(contents(db)).toEqual(withActiveWorkflows(before));
    expect(columns(db).at(-1)).toBe("paused");
    expectHealthy(db);
  });

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(67);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=68
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 68 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=68").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToPaused(db);
    expect(contents(db)).toEqual(withActiveWorkflows(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(67);
    seed(db);
    db.exec("ALTER TABLE workflows ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE workflows SET paused=1 WHERE workflow_id='workflow-2'");
    migrateToPaused(db);
    expect(columns(db).filter((name) => name === "paused")).toEqual(["paused"]);
    expect(db.prepare("SELECT workflow_id, paused FROM workflows ORDER BY workflow_id").all()).toEqual([
      { workflow_id: "workflow-1", paused: 0 },
      { workflow_id: "workflow-2", paused: 1 },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(67);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=46");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 46");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
  });

  it("makes a release before the paused state refuse a database with a paused workflow", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(pausedMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(pausedMigration.version).toBeGreaterThan(olderNewest);

    const db = databaseAt(67);
    seed(db);
    migrateOpenBotDatabase(db);
    db.exec("UPDATE workflows SET paused=1 WHERE workflow_id='workflow-1'");
    const after = contents(db);

    vi.resetModules();
    vi.doMock("./migrations/registry", async (importOriginal) => {
      const registry = await importOriginal<typeof Registry>();
      return { ...registry, MIGRATIONS: registry.MIGRATIONS.filter((entry) => entry.version <= olderNewest) };
    });
    const older = await import("./openbot-database-schema");
    expect(older.LATEST_SCHEMA_VERSION).toBe(olderNewest);
    expect(() => older.migrateOpenBotDatabase(db)).toThrow(older.NewerDatabaseError);
    expect(contents(db)).toEqual(after);
  });

  it("refuses a paused value other than 0 or 1, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(67);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      expect(() => db.exec("UPDATE workflows SET paused=2 WHERE workflow_id='workflow-1'")).toThrow(
        /CHECK constraint failed/u,
      );
      expect(() => db.exec("UPDATE workflows SET paused=NULL WHERE workflow_id='workflow-1'")).toThrow(
        /NOT NULL constraint failed/u,
      );
      db.exec("UPDATE workflows SET paused=1 WHERE workflow_id='workflow-1'");
      expect(db.prepare("SELECT workflow_id, paused FROM workflows ORDER BY workflow_id").all()).toEqual([
        { workflow_id: "workflow-1", paused: 1 },
        { workflow_id: "workflow-2", paused: 0 },
      ]);
      expectHealthy(db, LATEST_SCHEMA_VERSION);
    }
  });
});
