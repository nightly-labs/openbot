// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; an old thread reads as a branch; a
// failed upgrade leaves a column or the marker; a retry adds a column twice; a newer or incomplete
// history is accepted; a branch link to a deleted thread breaks the foreign-key check. Sources 8 to 46
// reach version 48 in `agent-thread-migration.test.ts`; these fixtures cover the version 47 source.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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

/** The agent's own chat, an open thread with a message and a closed thread, in the version 47 columns. */
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

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, Record<string, SQLOutputValue>[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

/** What the upgrade adds to each old thread: a null branch link. */
function withBranchLink(
  before: Record<string, Record<string, SQLOutputValue>[]>,
): Record<string, Record<string, SQLOutputValue>[]> {
  return {
    ...before,
    projection_agent_threads: (before.projection_agent_threads ?? []).map((row) => ({
      ...row,
      branch_source_thread_id: null,
      branch_source_message_id: null,
      branch_through_message_id: null,
    })),
  };
}

function threadColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(projection_agent_threads)")
    .all()
    .map((column) => String(column.name));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 48 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("agent thread branch migration", () => {
  it("keeps every row from released schema 47, and no old thread is a branch", () => {
    const db = databaseAt(47);
    seed(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withBranchLink(before));
    expect(threadColumns(db).slice(-3)).toEqual(BRANCH_COLUMNS);
    expectHealthy(db);
  });

  it("rolls back every column and the marker after a late failure, then retries", () => {
    const db = databaseAt(47);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=48
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 48 failed");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=48").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withBranchLink(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(47);
    seed(db);
    db.exec("ALTER TABLE projection_agent_threads ADD COLUMN branch_source_thread_id TEXT");
    db.exec("UPDATE projection_agent_threads SET branch_source_thread_id='openbot-thread-chief' WHERE origin='user'");
    migrateOpenBotDatabase(db);
    expect(threadColumns(db).slice(-3)).toEqual(BRANCH_COLUMNS);
    expect(
      db
        .prepare(
          `SELECT thread_id, branch_source_thread_id, branch_source_message_id, branch_through_message_id
           FROM projection_agent_threads ORDER BY thread_id`,
        )
        .all(),
    ).toEqual([
      {
        thread_id: "openbot-thread-closed",
        branch_source_thread_id: null,
        branch_source_message_id: null,
        branch_through_message_id: null,
      },
      {
        thread_id: "openbot-thread-open",
        branch_source_thread_id: "openbot-thread-chief",
        branch_source_message_id: null,
        branch_through_message_id: null,
      },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds a column", () => {
    const db = databaseAt(47);
    seed(db);
    const before = contents(db);
    const columnsBefore = threadColumns(db);
    db.exec("INSERT INTO schema_migrations VALUES(49,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=49; DELETE FROM schema_migrations WHERE version=46");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 46");
    expect(contents(db)).toEqual(before);
    expect(threadColumns(db)).toEqual(columnsBefore);
  });

  it("refuses to open a version 48 database in an older application", () => {
    const db = databaseAt(47);
    seed(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    // An application one release older knows versions up to 47: version 48 is newer than it supports.
    db.exec("INSERT INTO schema_migrations VALUES(49,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("keeps a branch when its source thread is deleted", () => {
    const db = databaseAt(47);
    seed(db);
    migrateOpenBotDatabase(db);
    db.exec(`UPDATE projection_agent_threads SET branch_source_thread_id='openbot-thread-closed',
      branch_source_message_id='message-1', branch_through_message_id='message-2'
      WHERE thread_id='openbot-thread-open'`);
    db.exec("DELETE FROM projection_threads WHERE thread_id='openbot-thread-closed'");
    expect(db.prepare("SELECT thread_id, branch_source_thread_id FROM projection_agent_threads").all()).toEqual([
      { thread_id: "openbot-thread-open", branch_source_thread_id: "openbot-thread-closed" },
    ]);
    expectHealthy(db);
  });
});
