// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as runChangesMigration } from "./migrations/0069-agent-routine-run-changes";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const PREVIOUS = runChangesMigration.version - 1;
const SOURCES = Array.from({ length: PREVIOUS - 32 }, (_, index) => index + 33);
const COLUMN = "runs_change_routines";

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

function migrateToRunChanges(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > runChangesMigration.version) migrateUpTo(db, runChangesMigration.version);
  else migrateOpenBotDatabase(db);
}

function seed(db: DatabaseSync): void {
  const stamp = "2026-10-01T07:00:00.000Z";
  db.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES ('ops', '{}')").run();
  db.prepare(
    `INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
       updated_at, last_event_sequence) VALUES ('routine-triage', 'chief', 'Mail triage', 'Sort the mail. 界"\\',
       1, 'Europe/Berlin', ?, ?, 1), ('routine-archive', 'chief', 'Archive', 'Archive the queued mail.', 0,
       'Europe/Berlin', ?, ?, 2)`,
  ).run(stamp, stamp, stamp, stamp);
  db.prepare(
    `INSERT INTO projection_routine_triggers (trigger_id, routine_id, schedule_json, next_run_at, created_at,
       updated_at, last_event_sequence) VALUES ('trigger-archive', 'routine-archive', '{"kind":"daily","time":"09:00"}',
       '2026-10-02T07:00:00.000Z', ?, ?, 3)`,
  ).run(stamp, stamp);
  db.prepare(
    `INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
       routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
     VALUES ('run-archive', 'routine-archive', 'chief', 'trigger-archive', 'scheduled', ?, 'Archive',
       'Archive the queued mail.', 'delivery-1', 'succeeded', NULL, ?, ?, 4)`,
  ).run(stamp, stamp, stamp);
  db.prepare(
    `INSERT INTO projection_channel_routines (routine_id, channel_id, name, instruction, active, timezone,
       created_at, updated_at, last_event_sequence) VALUES ('routine-channel', 'ops', 'Stand-up', 'Ask for news.',
       0, 'UTC', ?, ?, 5)`,
  ).run(stamp, stamp);
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

function withRunChangesOff(before: Contents): Contents {
  return {
    ...before,
    projection_agent_routines: (before.projection_agent_routines ?? []).map((row) => ({ ...row, [COLUMN]: 0 })),
  };
}

function columns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync, version = runChangesMigration.version): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent routine run changes migration", () => {
  it.each(SOURCES)("keeps every row from released schema %i, and no routine run may change routines", (source) => {
    const db = databaseAt(source);
    seed(db);
    if (source < PREVIOUS) migrateUpTo(db, PREVIOUS);
    const before = contents(db);
    migrateToRunChanges(db);
    expect(contents(db)).toEqual(withRunChangesOff(before));
    expect(columns(db, "projection_agent_routines").at(-1)).toBe(COLUMN);
    expect(columns(db, "projection_channel_routines")).not.toContain(COLUMN);
    expectHealthy(db);
  });

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(PREVIOUS);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_agent_routines");
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations
      WHEN new.version=${runChangesMigration.version} BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${runChangesMigration.version} failed`);
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_agent_routines")).toEqual(columnsBefore);
    expect(
      db.prepare("SELECT version FROM schema_migrations WHERE version=?").all(runChangesMigration.version),
    ).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToRunChanges(db);
    expect(contents(db)).toEqual(withRunChangesOff(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(PREVIOUS);
    seed(db);
    db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN ${COLUMN} INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE projection_agent_routines SET ${COLUMN}=1 WHERE routine_id='routine-triage'`);
    migrateToRunChanges(db);
    expect(columns(db, "projection_agent_routines").filter((name) => name === COLUMN)).toEqual([COLUMN]);
    expect(db.prepare(`SELECT routine_id, ${COLUMN} FROM projection_agent_routines ORDER BY routine_id`).all()).toEqual(
      [
        { routine_id: "routine-archive", [COLUMN]: 0 },
        { routine_id: "routine-triage", [COLUMN]: 1 },
      ],
    );
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(PREVIOUS);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_agent_routines");
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=54");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 54");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_agent_routines")).toEqual(columnsBefore);
  });

  it("makes a release before the setting refuse a database that has it", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(runChangesMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(runChangesMigration.version).toBeGreaterThan(olderNewest);

    const db = databaseAt(PREVIOUS);
    seed(db);
    migrateOpenBotDatabase(db);
    db.exec(`UPDATE projection_agent_routines SET ${COLUMN}=1 WHERE routine_id='routine-triage'`);
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

  it("refuses a value that is not on or off, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(PREVIOUS);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      const values = () =>
        db.prepare(`SELECT routine_id, ${COLUMN} FROM projection_agent_routines ORDER BY routine_id`).all();
      expect(values()).toEqual([
        { routine_id: "routine-archive", [COLUMN]: 0 },
        { routine_id: "routine-triage", [COLUMN]: 0 },
      ]);
      db.exec(`UPDATE projection_agent_routines SET ${COLUMN}=1 WHERE routine_id='routine-triage'`);
      expect(() => db.exec(`UPDATE projection_agent_routines SET ${COLUMN}=2`)).toThrow(/CHECK constraint failed/u);
      expect(values()).toEqual([
        { routine_id: "routine-archive", [COLUMN]: 0 },
        { routine_id: "routine-triage", [COLUMN]: 1 },
      ]);
      expectHealthy(db, LATEST_SCHEMA_VERSION);
    }
  });
});
