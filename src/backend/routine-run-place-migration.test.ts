// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old agent routine runs in a thread; a
// channel routine gets the column; a failed upgrade leaves the column or the marker; a retry adds the column
// twice or drops a development value; a newer or incomplete history is accepted; the CHECK accepts a place
// that the app cannot read. Sources 8 to 34 reach version 61 in `routine-run-columns-migration.test.ts`.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const SOURCES = Array.from({ length: 24 }, (_, index) => index + 33);

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

/** An agent routine with a trigger and a run, and a channel routine, in the columns every release has. */
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
       routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
     VALUES ('run-agent', 'routine-agent', 'chief', 'trigger-agent', 'scheduled', ?, 'Morning brief',
       'Collect the news.', 'delivery-1', 'succeeded', NULL, ?, ?, 3)`,
  ).run(stamp, stamp, stamp);
  db.prepare(
    `INSERT INTO projection_channel_routines (routine_id, channel_id, name, instruction, active, timezone,
       created_at, updated_at, last_event_sequence) VALUES ('routine-channel', 'ops', 'Stand-up', 'Ask for news.',
       0, 'UTC', ?, ?, 4)`,
  ).run(stamp, stamp);
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

// Migrations 58, 59 and 61 run after 57 and add these empty tables.
const LATER_TABLES = {
  agent_usage_skill_loads: [],
  projection_messaging_pings: [],
  projection_pinned_thread_messages: [],
};

/** The source rows, and each agent routine runs in the chat, as it did before the column. */
function withChatRunPlace(before: Contents): Contents {
  return {
    ...before,
    projection_agent_routines: (before.projection_agent_routines ?? []).map((row) => ({ ...row, run_in: "chat" })),
  };
}

function columns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 61 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent routine run place migration", () => {
  for (const source of SOURCES) {
    it(`keeps every row from released schema ${source}, and each agent routine runs in the chat`, () => {
      const db = databaseAt(source);
      seed(db);
      // The earlier migrations run first; the rows after them are what v57 must keep.
      if (source < 56) migrateUpTo(db, 56);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...withChatRunPlace(before), ...LATER_TABLES });
      expect(columns(db, "projection_agent_routines")).toContain("run_in");
      expect(columns(db, "projection_channel_routines")).not.toContain("run_in");
      expectHealthy(db);
    });
  }

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(56);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_agent_routines");
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=57
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 57 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_agent_routines")).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=57").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...withChatRunPlace(before), ...LATER_TABLES });
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(56);
    seed(db);
    db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN run_in TEXT NOT NULL DEFAULT 'chat'
      CHECK(run_in IN ('chat', 'thread'))`);
    db.exec("UPDATE projection_agent_routines SET run_in='thread'");
    migrateOpenBotDatabase(db);
    expect(columns(db, "projection_agent_routines").filter((name) => name === "run_in")).toEqual(["run_in"]);
    expect(db.prepare("SELECT routine_id, run_in FROM projection_agent_routines").all()).toEqual([
      { routine_id: "routine-agent", run_in: "thread" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(56);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db, "projection_agent_routines");
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=62; DELETE FROM schema_migrations WHERE version=54");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 54");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "projection_agent_routines")).toEqual(columnsBefore);
  });

  it("refuses to open a version 57 database in an older application", () => {
    const db = databaseAt(56);
    seed(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    // An application one release older knows versions up to 61 at most: version 62 is newer than it supports.
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("rejects a place that the app cannot read, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(56);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      expect(db.prepare("SELECT run_in FROM projection_agent_routines").all()).toEqual([{ run_in: "chat" }]);
      db.exec("UPDATE projection_agent_routines SET run_in='thread'");
      expect(() => db.exec("UPDATE projection_agent_routines SET run_in='channel'")).toThrow(
        /CHECK constraint failed/u,
      );
      expect(db.prepare("SELECT run_in FROM projection_agent_routines").all()).toEqual([{ run_in: "thread" }]);
    }
  });
});
