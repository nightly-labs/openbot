// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old memory gets a site; a failed
// upgrade leaves the column, the index or the marker; a retry adds the column twice or drops a development
// value; a newer or incomplete history is accepted; the CHECK accepts a site that the app cannot read.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// Every released schema from the first registry version to the one before this migration.
const SOURCES = Array.from({ length: 52 }, (_, index) => index + 8);

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

/** Two memories of two agents, in the columns every release has. */
function seed(db: DatabaseSync): void {
  const insert = db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES (?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', ?)`);
  insert.run("memory-1", "chief", 'Use the client VPN 界"\\', 'Use the client VPN 界"\\', "manual", null, 2);
  insert.run(
    "memory-2",
    "research",
    "The report is due on Fridays.",
    "The report is due on Fridays.",
    "automatic",
    "turn-1",
    3,
  );
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

/** The source rows, and each memory has no site, as before the column. */
function withNoSite(before: Contents): Contents {
  return {
    ...before,
    projection_agent_memories: (before.projection_agent_memories ?? []).map((row) => ({ ...row, site: null })),
  };
}

function columns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(projection_agent_memories)")
    .all()
    .map((column) => String(column.name));
}

function siteIndex(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='agent_memories_site'").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 60 });
  expect(siteIndex(db)).toEqual([{ name: "agent_memories_site" }]);
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent memory site migration", () => {
  for (const source of SOURCES) {
    it(`keeps every row from released schema ${source}, and each memory has no site`, () => {
      const db = databaseAt(source);
      seed(db);
      // The earlier migrations run first; the rows after them are what v60 must keep.
      if (source < 59) migrateUpTo(db, 59);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual(withNoSite(before));
      expect(columns(db)).toContain("site");
      // Search still finds an old memory, so the column did not break the full-text index.
      expect(
        db
          .prepare(
            `SELECT m.memory_id FROM agent_memory_search JOIN projection_agent_memories m
             ON m.rowid = agent_memory_search.rowid WHERE agent_memory_search MATCH '"Fridays"'`,
          )
          .all(),
      ).toEqual([{ memory_id: "memory-2" }]);
      expectHealthy(db);
    });
  }

  it("rolls back the column, the index and the marker after a late failure, then retries", () => {
    const db = databaseAt(59);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=60
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 60 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
    expect(siteIndex(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=60").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withNoSite(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(59);
    seed(db);
    db.exec("ALTER TABLE projection_agent_memories ADD COLUMN site TEXT");
    db.exec("UPDATE projection_agent_memories SET site='github.com' WHERE memory_id='memory-1'");
    migrateOpenBotDatabase(db);
    expect(columns(db).filter((name) => name === "site")).toEqual(["site"]);
    expect(db.prepare("SELECT memory_id, site FROM projection_agent_memories ORDER BY memory_id").all()).toEqual([
      { memory_id: "memory-1", site: "github.com" },
      { memory_id: "memory-2", site: null },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(59);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.exec("INSERT INTO schema_migrations VALUES(61,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=61; DELETE FROM schema_migrations WHERE version=57");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 57");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
    expect(siteIndex(db)).toEqual([]);
  });

  it("refuses to open a version 60 database in an older application", () => {
    const db = databaseAt(59);
    seed(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    // An application one release newer than an older one adds 61: this one is the older application for it.
    db.exec("INSERT INTO schema_migrations VALUES(61,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("rejects a site that the app cannot read, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(59);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      db.exec("UPDATE projection_agent_memories SET site='github.com' WHERE memory_id='memory-1'");
      for (const site of ["", "a".repeat(254)])
        expect(() =>
          db.prepare("UPDATE projection_agent_memories SET site=? WHERE memory_id='memory-1'").run(site),
        ).toThrow(/CHECK constraint failed/u);
      expect(db.prepare("SELECT memory_id, site FROM projection_agent_memories ORDER BY memory_id").all()).toEqual([
        { memory_id: "memory-1", site: "github.com" },
        { memory_id: "memory-2", site: null },
      ]);
    }
  });
});
