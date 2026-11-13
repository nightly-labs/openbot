// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old run shows as quiet; a channel run
// gets the column; a failed upgrade leaves the column or the marker; a retry adds the column twice or drops
// a development value; a newer or incomplete history is accepted; the CHECK accepts a value that the app
// cannot read. Sources 8 to 34 reach version 62 in `routine-run-columns-migration.test.ts`.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const SOURCES = Array.from({ length: 27 }, (_, index) => index + 35);

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

/** An agent routine with a scheduled and a script run, and a channel routine with a run, in the columns of release 35. */
function seed(db: DatabaseSync): void {
  const stamp = "2026-10-01T07:00:00.000Z";
  db.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES ('ops', '{}')").run();
  db.prepare(
    `INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
       updated_at, last_event_sequence) VALUES ('routine-agent', 'chief', 'Morning brief', 'Collect the news. 界"\\',
       1, 'Europe/Warsaw', ?, ?, 1)`,
  ).run(stamp, stamp);
  db.prepare(
    `INSERT INTO projection_routine_triggers (trigger_id, routine_id, schedule_json, next_run_at, created_at,
       updated_at, last_event_sequence) VALUES ('trigger-agent', 'routine-agent', '{"kind":"daily","time":"09:00"}',
       '2026-10-02T07:00:00.000Z', ?, ?, 2)`,
  ).run(stamp, stamp);
  db.prepare(
    `INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
       routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence,
       missed_count, missed_until, run_source)
     VALUES ('run-scheduled', 'routine-agent', 'chief', 'trigger-agent', 'scheduled', ?, 'Morning brief',
       'Collect the news.', 'delivery-1', 'succeeded', NULL, ?, ?, 3, 2, ?, NULL),
       ('run-script', 'routine-agent', 'chief', NULL, 'manual', ?, 'Morning brief', 'Collect the news.',
       'delivery-2', 'failed', 'The site did not answer.', ?, ?, 4, NULL, NULL, 'script')`,
  ).run(stamp, stamp, stamp, stamp, stamp, stamp, stamp);
  db.prepare(
    `INSERT INTO projection_channel_routines (routine_id, channel_id, name, instruction, active, timezone,
       created_at, updated_at, last_event_sequence) VALUES ('routine-channel', 'ops', 'Stand-up', 'Ask for news.',
       0, 'UTC', ?, ?, 5)`,
  ).run(stamp, stamp);
  db.prepare(
    `INSERT INTO projection_channel_routine_runs (run_id, routine_id, channel_id, trigger_id, run_kind,
       scheduled_for, routine_name, instruction, request_message_id, status, error, created_at, updated_at,
       last_event_sequence) VALUES ('run-channel', 'routine-channel', 'ops', NULL, 'manual', ?, 'Stand-up',
       'Ask for news.', NULL, 'succeeded', NULL, ?, ?, 6)`,
  ).run(stamp, stamp, stamp);
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

/** Every row of every table, by table name. */
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

/** The source rows, and no agent routine run is quiet: the app did not keep that before. */
function withNoQuietRuns(before: Contents): Contents {
  return {
    ...before,
    projection_routine_runs: (before.projection_routine_runs ?? []).map((row) => ({ ...row, quiet: 0 })),
  };
}

function columns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 62 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent routine run quiet migration", () => {
  for (const source of SOURCES) {
    it(`keeps every row from released schema ${source}, and no old run is quiet`, () => {
      const db = databaseAt(source);
      seed(db);
      // The earlier migrations run first; the rows after them are what v62 must keep.
      if (source < 61) migrateUpTo(db, 61);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual(withNoQuietRuns(before));
      expect(columns(db, "projection_routine_runs")).toContain("quiet");
      expect(columns(db, "projection_channel_routine_runs")).not.toContain("quiet");
      expectHealthy(db);
    });
  }

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(61);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_routine_runs");
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=62
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 62 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_routine_runs")).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=62").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withNoQuietRuns(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(61);
    seed(db);
    db.exec("ALTER TABLE projection_routine_runs ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0 CHECK(quiet IN (0, 1))");
    db.exec("UPDATE projection_routine_runs SET quiet=1 WHERE run_id='run-scheduled'");
    migrateOpenBotDatabase(db);
    expect(columns(db, "projection_routine_runs").filter((name) => name === "quiet")).toEqual(["quiet"]);
    expect(db.prepare("SELECT run_id, quiet FROM projection_routine_runs ORDER BY run_id").all()).toEqual([
      { run_id: "run-scheduled", quiet: 1 },
      { run_id: "run-script", quiet: 0 },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(61);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_routine_runs");
    db.exec("INSERT INTO schema_migrations VALUES(63,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=63; DELETE FROM schema_migrations WHERE version=57");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 57");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_routine_runs")).toEqual(columnsBefore);
  });

  it("refuses to open a version 62 database in an older application", () => {
    const db = databaseAt(61);
    seed(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    // An application one release older knows versions up to 62 at most: version 63 is newer than it supports.
    db.exec("INSERT INTO schema_migrations VALUES(63,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("rejects a value that the app cannot read, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(61);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      expect(db.prepare("SELECT quiet FROM projection_routine_runs ORDER BY run_id").all()).toEqual([
        { quiet: 0 },
        { quiet: 0 },
      ]);
      db.exec("UPDATE projection_routine_runs SET quiet=1 WHERE run_id='run-scheduled'");
      expect(() => db.exec("UPDATE projection_routine_runs SET quiet=2")).toThrow(/CHECK constraint failed/u);
      expect(db.prepare("SELECT quiet FROM projection_routine_runs ORDER BY run_id").all()).toEqual([
        { quiet: 1 },
        { quiet: 0 },
      ]);
    }
  });
});
