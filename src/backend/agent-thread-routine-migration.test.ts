// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old thread reads as the thread of a
// routine; a failed upgrade leaves the column, the index or the marker; a retry adds the column twice; a
// newer or incomplete history is accepted; a routine gets two threads. Sources 8 to 46 reach version 61
// in `agent-thread-migration.test.ts`; these fixtures cover every released source that has the table.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const SOURCES = [47, 48, 49, 50, 51, 52, 53];
const BRANCH_COLUMNS = ["branch_source_thread_id", "branch_source_message_id", "branch_through_message_id"];

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

/** The agent's own chat, an open thread and an archived thread, in the version 47 columns. */
function seed(db: DatabaseSync): void {
  const conversation = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  conversation.run("openbot-thread-chief", 'Chief 界"\\', "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  conversation.run("openbot-thread-open", "Billing export", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z");
  conversation.run("openbot-thread-closed", "Release notes", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z");
  db.exec(`INSERT INTO projection_agent_threads
    (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
     archived_at, last_event_sequence)
    VALUES ('openbot-thread-open', 'chief', NULL, 'user', 'Billing export 界"\\', 'user', NULL, NULL,
        '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', NULL, 4),
      ('openbot-thread-closed', 'chief', 'agent-task-closed', 'agent', 'Release notes', 'agent', 'failed',
        'Provider said no', '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z', '2026-10-03T09:00:00.000Z', 7)`);
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

/**
 * Each table of the source with the rows it had. Each old thread gets a null routine link, and a null
 * branch link when the source is older than migration 48.
 */
function expectRowsKept(before: Contents, after: Contents): void {
  for (const [table, rows] of Object.entries(before)) {
    if (table !== "projection_agent_threads") {
      expect(after[table], table).toEqual(rows);
      continue;
    }
    expect(after[table]).toEqual(
      rows.map((row) => ({
        branch_source_thread_id: null,
        branch_source_message_id: null,
        branch_through_message_id: null,
        ...row,
        routine_id: null,
      })),
    );
  }
}

function threadColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(projection_agent_threads)")
    .all()
    .map((column) => String(column.name));
}

function routineIndex(db: DatabaseSync): SQLOutputValue | undefined {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='agent_threads_routine'").get()?.sql;
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 61 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function insertRoutineThread(db: DatabaseSync, threadId: string, agentId: string, routineId: string): void {
  db.prepare("INSERT INTO projection_threads VALUES (?, ?, 'Daily report', NULL, ?, ?, 1)").run(
    threadId,
    agentId,
    "2026-11-01T08:00:00.000Z",
    "2026-11-01T08:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO projection_agent_threads
      (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
       archived_at, last_event_sequence, routine_id)
      VALUES (?, ?, NULL, 'agent', 'Daily report', 'agent', NULL, NULL, '2026-11-01T08:00:00.000Z',
        '2026-11-01T08:00:00.000Z', NULL, 1, ?)`,
  ).run(threadId, agentId, routineId);
}

describe("agent thread routine migration", () => {
  for (const source of SOURCES) {
    it(`keeps every row from released schema ${source}, and no old thread belongs to a routine`, () => {
      const db = databaseAt(source);
      seed(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expectRowsKept(before, contents(db));
      expect(threadColumns(db).slice(-4)).toEqual([...BRANCH_COLUMNS, "routine_id"]);
      expect(routineIndex(db)).toContain("WHERE routine_id IS NOT NULL");
      expectHealthy(db);
    });
  }

  it("rolls back the column, the index and the marker after a late failure, then retries", () => {
    const db = databaseAt(53);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=54
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 54 failed");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
    expect(routineIndex(db)).toBeUndefined();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=54").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectRowsKept(before, contents(db));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(53);
    seed(db);
    db.exec("ALTER TABLE projection_agent_threads ADD COLUMN routine_id TEXT");
    db.exec("UPDATE projection_agent_threads SET routine_id='routine-daily' WHERE thread_id='openbot-thread-open'");
    migrateOpenBotDatabase(db);
    expect(threadColumns(db).filter((name) => name === "routine_id")).toEqual(["routine_id"]);
    expect(db.prepare("SELECT thread_id, routine_id FROM projection_agent_threads ORDER BY thread_id").all()).toEqual([
      { thread_id: "openbot-thread-closed", routine_id: null },
      { thread_id: "openbot-thread-open", routine_id: "routine-daily" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(53);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=62; DELETE FROM schema_migrations WHERE version=47");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 47");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
    expect(routineIndex(db)).toBeUndefined();
  });

  it("refuses to open a version 54 database in an older application", () => {
    const db = databaseAt(53);
    seed(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    // An application one release older knows versions up to 58 at most: version 59 is newer than it supports.
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("gives a routine one thread, also when it is archived, and keeps routines of other agents apart", () => {
    const db = databaseAt(53);
    seed(db);
    migrateOpenBotDatabase(db);
    insertRoutineThread(db, "openbot-thread-routine", "chief", "routine-daily");
    db.exec("UPDATE projection_agent_threads SET archived_at='2026-11-02T08:00:00.000Z' WHERE routine_id IS NOT NULL");
    expect(() => insertRoutineThread(db, "openbot-thread-routine-2", "chief", "routine-daily")).toThrow(
      "UNIQUE constraint failed",
    );
    insertRoutineThread(db, "openbot-thread-routine-3", "writer", "routine-daily");
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_agent_threads WHERE routine_id IS NULL").get()).toEqual(
      {
        count: 2,
      },
    );
    db.exec("DELETE FROM projection_threads WHERE thread_id='openbot-thread-routine'");
    insertRoutineThread(db, "openbot-thread-routine-4", "chief", "routine-daily");
    expectHealthy(db);
  });
});
