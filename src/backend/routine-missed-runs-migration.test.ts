// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses a routine, trigger or run; an old routine gets a policy other than
// "skip"; an old run reads as a missed-run record; a partial migration survives a failure; a retry
// adds a column twice; a newer or incomplete history is changed; the new CHECKs accept bad values.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** The agent routine tables are the v8 baseline's. Migration 19 added the channel ones. */
const CHANNEL_ROUTINES_SINCE = 19;

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

/** One active routine with a trigger and two runs per owner kind, in the columns every release has. */
function seedRoutines(db: DatabaseSync, version: number): void {
  const stamp = "2026-10-01T07:00:00.000Z";
  const owners = [
    { routines: "projection_agent_routines", triggers: "projection_routine_triggers", runs: "projection_routine_runs" },
    ...(version >= CHANNEL_ROUTINES_SINCE
      ? [
          {
            routines: "projection_channel_routines",
            triggers: "projection_channel_routine_triggers",
            runs: "projection_channel_routine_runs",
          },
        ]
      : []),
  ];
  if (version >= CHANNEL_ROUTINES_SINCE) {
    db.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES ('owner', '{}')").run();
  }
  for (const [index, table] of owners.entries()) {
    const owner = index === 0 ? "agent_id" : "channel_id";
    const handle = index === 0 ? "delivery_id" : "request_message_id";
    db.prepare(
      `INSERT INTO ${table.routines} (routine_id, ${owner}, name, instruction, active, timezone, created_at,
         updated_at, last_event_sequence) VALUES (?, 'owner', 'Morning brief', 'Collect the news.', 1,
         'Europe/Warsaw', ?, ?, 1)`,
    ).run(`routine-${index}`, stamp, stamp);
    db.prepare(
      `INSERT INTO ${table.triggers} (trigger_id, routine_id, schedule_json, next_run_at, created_at, updated_at,
         last_event_sequence) VALUES (?, ?, '{"kind":"daily","time":"09:00"}', '2026-10-02T07:00:00.000Z', ?, ?, 2)`,
    ).run(`trigger-${index}`, `routine-${index}`, stamp, stamp);
    const run = db.prepare(
      `INSERT INTO ${table.runs} (run_id, routine_id, ${owner}, trigger_id, run_kind, scheduled_for, routine_name,
         instruction, ${handle}, status, error, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, 'owner', ?, ?, ?, 'Morning brief', 'Collect the news.', ?, ?, ?, ?, ?, 3)`,
    );
    run.run(
      `run-${index}-a`,
      `routine-${index}`,
      `trigger-${index}`,
      "scheduled",
      stamp,
      `handle-${index}`,
      "succeeded",
      null,
      stamp,
      stamp,
    );
    run.run(`run-${index}-b`, `routine-${index}`, null, "manual", stamp, null, "cancelled", "Stopped.", stamp, stamp);
  }
}

type TableRow = Record<string, SQLOutputValue>;

const ROUTINE_TABLES = [
  "projection_agent_routines",
  "projection_routine_triggers",
  "projection_routine_runs",
  "projection_channel_routines",
  "projection_channel_routine_triggers",
  "projection_channel_routine_runs",
] as const;

/** The routine tables that exist, or the named ones. A later migration can add the channel tables. */
function rows(db: DatabaseSync, tables?: readonly string[]): Record<string, TableRow[]> {
  const present = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  return Object.fromEntries(
    (tables ?? ROUTINE_TABLES.filter((table) => present.has(table))).map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

/**
 * What the upgrade adds to each old row: the "skip" policy, and no missed-run record. A source before
 * migration 27 also gets that migration's "wait" limit policy.
 */
function withMissedColumns(before: Record<string, TableRow[]>): Record<string, TableRow[]> {
  return Object.fromEntries(
    Object.entries(before).map(([table, tableRows]) => [
      table,
      tableRows.map((row) =>
        table.endsWith("_routines")
          ? { limit_policy: "wait", ...row, missed_policy: "skip" }
          : table.endsWith("_runs")
            ? { ...row, missed_count: null, missed_until: null }
            : row,
      ),
    ]),
  );
}

describe("routine missed-run migration", () => {
  it.each(Array.from({ length: 25 }, (_, index) => index + 8))(
    "keeps every routine, trigger and run from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seedRoutines(db, version);
      const before = rows(db);
      migrateOpenBotDatabase(db);
      expect(rows(db, Object.keys(before))).toEqual(withMissedColumns(before));
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 33 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back every column and the marker after a late failure, then retries", () => {
    const db = databaseAt(32);
    seedRoutines(db, 32);
    const before = rows(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 33
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 33 failed");
    expect(rows(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 33").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(rows(db)).toEqual(withMissedColumns(before));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("keeps a column that a development build added before the marker", () => {
    const db = databaseAt(32);
    seedRoutines(db, 32);
    db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN missed_policy TEXT NOT NULL DEFAULT 'skip'
      CHECK(missed_policy IN ('skip', 'run-once'))`);
    db.prepare("UPDATE projection_agent_routines SET missed_policy = 'run-once'").run();
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT missed_policy FROM projection_agent_routines").all()).toEqual([
      { missed_policy: "run-once" },
    ]);
    expect(db.prepare("SELECT missed_policy FROM projection_channel_routines").all()).toEqual([
      { missed_policy: "skip" },
    ]);
  });

  it("rejects a policy or a count that the app cannot read", () => {
    const db = databaseAt(32);
    seedRoutines(db, 32);
    migrateOpenBotDatabase(db);
    for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
      expect(() => db.prepare(`UPDATE ${table} SET missed_policy = 'later'`).run()).toThrow(/CHECK constraint failed/u);
    }
    for (const table of ["projection_routine_runs", "projection_channel_routine_runs"]) {
      expect(() => db.prepare(`UPDATE ${table} SET missed_count = 0`).run()).toThrow(/CHECK constraint failed/u);
    }
  });

  it("rejects newer and incomplete migration histories before it changes a routine", () => {
    const db = databaseAt(32);
    seedRoutines(db, 32);
    const before = rows(db);
    db.exec("INSERT INTO schema_migrations VALUES(34, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 34; DELETE FROM schema_migrations WHERE version = 27");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 27");
    expect(rows(db)).toEqual(before);
  });
});
