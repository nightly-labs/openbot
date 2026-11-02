// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses or changes a routine run, flow link or flow step; a partial migration
// survives a failure; a retry fails on an index that the failed run left; a newer or incomplete history is
// changed.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** The routine run table is the v8 baseline's. Migration 31 added the flow tables. */
const ROUTINE_FLOWS_SINCE = 31;

const INDEXES = {
  routine_runs_status_updated: ["status", "updated_at"],
  routine_flow_steps_running: ["created_at", "step_id"],
  routine_flow_steps_updated: ["updated_at"],
};

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

/** A routine with an ended and a running run, and from v31 a flow link and its steps, in the columns every release has. */
function seedRoutineFlow(db: DatabaseSync, version: number): void {
  db.exec(`INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone,
      created_at, updated_at, last_event_sequence)
    VALUES ('routine-1', 'chief', 'Morning brief', 'Collect the news.', 1, 'Europe/Warsaw',
      '2026-10-01T07:00:00.000Z', '2026-10-01T07:00:00.000Z', 1);
    INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
      routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
    VALUES
      ('run-1', 'routine-1', 'chief', NULL, 'manual', '2026-10-01T09:00:00.000Z', 'Morning brief',
        'Collect the news.', 'delivery-1', 'succeeded', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:05:00.000Z', 2),
      ('run-2', 'routine-1', 'chief', NULL, 'manual', '2026-10-02T09:00:00.000Z', 'Morning brief',
        'Collect the news.', 'delivery-2', 'running', NULL, '2026-10-02T09:00:00.000Z', '2026-10-02T09:00:00.000Z', 3);`);
  if (version < ROUTINE_FLOWS_SINCE) return;
  db.exec(`INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, instruction, created_at)
    VALUES ('link-1', 'routine-1', 'chief', 'editor', 'Shorten it.', '2026-09-30T07:00:00.000Z');
    INSERT INTO routine_flow_steps (step_id, run_id, agent_id, delivery_id, input, output, status, error,
      created_at, updated_at)
    VALUES
      ('step-1', 'run-1', 'chief', NULL, 'Collect the news.', 'Three stories.', 'succeeded', NULL,
        '2026-10-01T09:05:00.000Z', '2026-10-01T09:05:00.000Z'),
      ('step-2', 'run-1', 'editor', 'delivery-3', 'Shorten it.', NULL, 'running', NULL,
        '2026-10-01T09:05:01.000Z', '2026-10-01T09:05:02.000Z');`);
}

function contents(db: DatabaseSync) {
  const tables = ["projection_agent_routines", "projection_routine_runs", "routine_flow_links", "routine_flow_steps"];
  return Object.fromEntries(
    tables
      .filter((table) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
      .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
}

function indexColumns(db: DatabaseSync) {
  return Object.fromEntries(
    Object.keys(INDEXES).map((name) => [
      name,
      db
        .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
        .all(name)
        .map((column) => column.name),
    ]),
  );
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 49 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

const NO_INDEXES = { routine_runs_status_updated: [], routine_flow_steps_running: [], routine_flow_steps_updated: [] };

describe("routine flow sweep index migration", () => {
  // The oldest released schema, the first with the flow tables, the newest released schema (v0.42.0), and
  // migration 41 on main.
  it.each([8, ROUTINE_FLOWS_SINCE, 40, 41])("upgrades v%i and keeps every run, link and step", (version) => {
    const db = databaseAt(version);
    seedRoutineFlow(db, version);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toMatchObject(before);
    expect(indexColumns(db)).toEqual(INDEXES);
    expectHealthy(db);
  });

  it("rolls back the indexes and the marker after a failure, then retries", () => {
    const db = databaseAt(41);
    seedRoutineFlow(db, 41);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 42
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 42 failed");
    expect(indexColumns(db)).toEqual(NO_INDEXES);
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 42").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expect(indexColumns(db)).toEqual(INDEXES);
    expectHealthy(db);
  });

  it("rolls back when an index name is taken, then retries", () => {
    const db = databaseAt(41);
    seedRoutineFlow(db, 41);
    const before = contents(db);
    // The last of the three: the two before it are made and must roll back. SQLite refuses an index whose
    // name a table holds, even with IF NOT EXISTS.
    db.exec("CREATE TABLE routine_flow_steps_updated (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 42 failed");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 42").all()).toEqual([]);
    expect(indexColumns(db)).toEqual(NO_INDEXES);
    expect(contents(db)).toEqual(before);
    db.exec("DROP TABLE routine_flow_steps_updated");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expect(indexColumns(db)).toEqual(INDEXES);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the indexes", () => {
    const db = databaseAt(41);
    seedRoutineFlow(db, 41);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(50, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 50; DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(indexColumns(db)).toEqual(NO_INDEXES);
  });
});
