// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as settingsMigration } from "./migrations/0066-workflow-step-settings";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const SOURCES = Array.from({ length: 20 }, (_, index) => index + 46);
const NEW_COLUMNS = ["settings_json", "sources_json"];

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

function migrateToSettings(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > settingsMigration.version) migrateUpTo(db, settingsMigration.version);
  else migrateOpenBotDatabase(db);
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO workflows (workflow_id, title, created_at, updated_at)
      VALUES ('workflow-1', 'Poster 界"\\', '2026-03-01', '2026-03-01');
    INSERT INTO workflow_runs (run_id, workflow_id, number, source, idempotency_key, graph_revision, graph_json,
        status, started_at, updated_at)
      VALUES ('run-1', 'workflow-1', 1, 'manual', 'manual:1', 0, '{"nodes":[],"edges":[],"strokes":[]}', 'done',
        '2026-03-01', '2026-03-01');
    INSERT INTO workflow_steps (step_id, workflow_id, run_id, node_id, attempt, request_id, kind, agent_id, status,
        input, output, created_at, updated_at)
      VALUES ('step-1', 'workflow-1', 'run-1', 'llm', 1, 'run-1:llm:1', 'llm', NULL, 'done', 'Write a 界"\\ title',
        'Night sale', '2026-03-01', '2026-03-01'),
             ('step-2', 'workflow-1', NULL, 'image', 1, 'request-2', 'image', NULL, 'failed', 'Night sale', NULL,
        '2026-03-02', '2026-03-02');
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

function withNoSettings(before: Contents): Contents {
  return {
    ...before,
    workflow_steps: (before.workflow_steps ?? []).map((row) => ({ ...row, settings_json: null, sources_json: null })),
  };
}

function columns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(workflow_steps)")
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync, version = settingsMigration.version): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("workflow step settings migration", () => {
  it.each(SOURCES)("keeps every row from released schema %i, and old steps have no recorded settings", (version) => {
    const db = databaseAt(version);
    seed(db);
    if (version < 65) migrateUpTo(db, 65);
    const before = contents(db);
    migrateToSettings(db);
    expect(contents(db)).toEqual(withNoSettings(before));
    expect(columns(db).slice(-2)).toEqual(NEW_COLUMNS);
    expectHealthy(db);
  });

  it("rolls back the columns and the marker after a late failure, then retries", () => {
    const db = databaseAt(65);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=66
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 66 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=66").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToSettings(db);
    expect(contents(db)).toEqual(withNoSettings(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(65);
    seed(db);
    db.exec("ALTER TABLE workflow_steps ADD COLUMN settings_json TEXT");
    db.exec(`UPDATE workflow_steps SET settings_json='{"model":"gpt-image-2"}' WHERE step_id='step-2'`);
    migrateToSettings(db);
    expect(columns(db).filter((name) => NEW_COLUMNS.includes(name))).toEqual(NEW_COLUMNS);
    expect(
      db.prepare("SELECT step_id, settings_json, sources_json FROM workflow_steps ORDER BY step_id").all(),
    ).toEqual([
      { step_id: "step-1", settings_json: null, sources_json: null },
      { step_id: "step-2", settings_json: '{"model":"gpt-image-2"}', sources_json: null },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the columns", () => {
    const db = databaseAt(65);
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

  it("makes a release before the settings refuse a database with recorded settings", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(settingsMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(settingsMigration.version).toBeGreaterThan(olderNewest);

    const db = databaseAt(65);
    seed(db);
    migrateOpenBotDatabase(db);
    db.exec(`UPDATE workflow_steps SET settings_json='{"prompt":"Night sale"}',
      sources_json='[{"from":"llm","type":"text","stepId":"step-1","attachmentId":null}]' WHERE step_id='step-2'`);
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

  it("refuses text that is not JSON, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(65);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      expect(columns(db).filter((name) => NEW_COLUMNS.includes(name))).toEqual(NEW_COLUMNS);
      for (const column of NEW_COLUMNS)
        expect(() => db.exec(`UPDATE workflow_steps SET ${column}='{model' WHERE step_id='step-1'`)).toThrow(
          /CHECK constraint failed/u,
        );
      db.exec(`UPDATE workflow_steps SET settings_json='{"model":"gpt-5"}', sources_json='[]' WHERE step_id='step-1'`);
      expect(db.prepare("SELECT settings_json, sources_json FROM workflow_steps WHERE step_id='step-1'").get()).toEqual(
        {
          settings_json: '{"model":"gpt-5"}',
          sources_json: "[]",
        },
      );
      expectHealthy(db, LATEST_SCHEMA_VERSION);
    }
  });
});
