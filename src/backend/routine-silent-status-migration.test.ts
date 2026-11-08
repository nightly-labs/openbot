// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
const TABLES = [
  "projection_agent_routines",
  "projection_channel_routines",
  "projection_routine_runs",
  "projection_channel_routine_runs",
];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function stopAt(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER fixture_stop BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER fixture_stop");
}

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  stopAt(db, version);
  return db;
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;
function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name",
    )
    .all();
  return Object.fromEntries(tables.map((row) => [String(row.name), db.prepare(`SELECT * FROM "${row.name}"`).all()]));
}

function withDefault(before: Contents): Contents {
  return Object.fromEntries(
    Object.entries(before).map(([table, rows]) => [
      table,
      TABLES.includes(table) ? rows.map((row) => ({ ...row, silent: 0 })) : rows,
    ]),
  );
}

function seed(db: DatabaseSync): void {
  const exists = (table: string) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  for (const [routine, run, owner, handle] of [
    ["projection_agent_routines", "projection_routine_runs", "agent_id", "delivery_id"],
    ["projection_channel_routines", "projection_channel_routine_runs", "channel_id", "request_message_id"],
  ]) {
    if (!routine || !run || !owner || !handle || !exists(routine)) continue;
    if (owner === "channel_id")
      db.exec("INSERT INTO projection_channels(channel_id,channel_json) VALUES ('fixture','{}')");
    db.exec(`INSERT INTO ${routine}(routine_id,${owner},name,instruction,active,timezone,created_at,updated_at,last_event_sequence)
      VALUES ('${owner}','fixture','Keep 界','Keep the report.',1,'UTC','2026-10-01','2026-10-01',1)`);
    db.exec(`INSERT INTO ${run}(run_id,routine_id,${owner},run_kind,scheduled_for,routine_name,instruction,${handle},status,created_at,updated_at,last_event_sequence)
      VALUES ('${owner}','${owner}','fixture','manual','2026-10-01','Keep 界','Keep the report.','handle','succeeded','2026-10-01','2026-10-01',2)`);
  }
}

function healthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("silent routine migration", () => {
  for (let source = 8; source <= 58; source += 1) {
    it(`keeps every row from released schema ${source} and defaults status to visible`, () => {
      const db = databaseAt(source);
      seed(db);
      if (source < 58) stopAt(db, 58);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual(withDefault(before));
      healthy(db);
    });
  }

  it("rolls back all four columns and the marker after a late failure, then retries", () => {
    const db = databaseAt(58);
    seed(db);
    const before = contents(db);
    db.exec(
      "CREATE TEMP TRIGGER fixture_failure BEFORE INSERT ON schema_migrations WHEN new.version=59 BEGIN SELECT RAISE(ABORT,'late failure'); END;",
    );
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 59 failed");
    expect(contents(db)).toEqual(before);
    for (const table of TABLES)
      expect(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((row) => row.name === "silent"),
      ).toBe(false);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=59").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fixture_failure");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withDefault(before));
    healthy(db);
  });

  it("keeps a development value and adds each column only once", () => {
    const db = databaseAt(58);
    seed(db);
    for (const table of TABLES) {
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN silent INTEGER NOT NULL DEFAULT 0 CHECK(silent IN (0,1)); UPDATE ${table} SET silent=1;`,
      );
    }
    const before = contents(db);
    migrateOpenBotDatabase(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    healthy(db);
  });

  it("rejects a newer or incomplete history without a data change", () => {
    const db = databaseAt(58);
    seed(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(60,'fixture')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=57");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 57");
    expect(contents(db)).toEqual(before);
  });

  it("rejects invalid and null values on both database build paths", () => {
    const upgraded = databaseAt(58);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    migrateOpenBotDatabase(fresh);
    seed(fresh);
    for (const db of [upgraded, fresh])
      for (const table of TABLES) {
        expect(() => db.exec(`UPDATE ${table} SET silent=2`)).toThrow(/CHECK constraint failed/u);
        expect(() => db.exec(`UPDATE ${table} SET silent=NULL`)).toThrow(/NOT NULL constraint failed/u);
        db.exec(`UPDATE ${table} SET silent=1`);
        expect(db.prepare(`SELECT silent FROM ${table}`).all()).toEqual([{ silent: 1 }]);
      }
  });
});
