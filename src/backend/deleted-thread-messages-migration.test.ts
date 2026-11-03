// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table
// or its marker; a newer or incomplete history is accepted; a deleted id can point to no thread, be
// empty or be recorded twice; a deleted thread leaves its ids behind. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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

/** A chat thread with a user message and an answer, the rows that migration 55 must keep. */
function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_threads
    (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('thread-chief', 'chief', 'Chief 界"\\', NULL, '2026-01-01', '2026-01-01', 3)`).run();
  const insert = db.prepare(`INSERT INTO projection_thread_messages
    (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
    VALUES ('thread-chief', ?, NULL, ?, 'completed', NULL, ?, ?, ?, 3)`);
  insert.run(
    "message-1",
    "user",
    "2026-01-01T09:00:00.000Z",
    0,
    JSON.stringify({ id: "message-1", author: "user", text: "Delete this 界", createdAt: "2026-01-01T09:00:00.000Z" }),
  );
  insert.run(
    "message-2",
    "assistant",
    "2026-01-01T09:00:01.000Z",
    1,
    JSON.stringify({ id: "message-2", author: "agent", text: "Done.", createdAt: "2026-01-01T09:00:01.000Z" }),
  );
}

/**
 * Every row of every table, by table name. Migration 47 replaces the empty task table with the thread
 * table; `agent-thread-migration.test.ts` checks that move.
 */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%'
       AND name NOT IN ('projection_agent_tasks', 'projection_agent_threads') ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function deletedTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%deleted_thread_messages%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 55 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("deleted thread messages migration", () => {
  it.each(Array.from({ length: 47 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db);
      // The earlier migrations run first; the rows after them are what v55 must keep.
      if (version < 54) migrateUpTo(db, 54);
      const before = contents(db);
      expect(before.projection_thread_messages).toHaveLength(2);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, projection_deleted_thread_messages: [] });
      expectHealthy(db);
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(54);
    seed(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=55
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 55 failed");
    expect(contents(db)).toEqual(before);
    expect(deletedTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=55").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, projection_deleted_thread_messages: [] });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(54);
    seed(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(56,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=56; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(deletedTables(db)).toEqual([]);
  });

  it("refuses an id of no thread, an empty id or a second record, and goes with its thread", () => {
    const db = databaseAt(54);
    seed(db);
    migrateOpenBotDatabase(db);
    const insert = db.prepare(`INSERT INTO projection_deleted_thread_messages (thread_id, message_id, deleted_at)
      VALUES (?, ?, '2026-01-02')`);
    expect(() => insert.run("thread-unknown", "message-1")).toThrow("FOREIGN KEY constraint failed");
    expect(() => insert.run("thread-chief", "")).toThrow("CHECK constraint failed");
    insert.run("thread-chief", "message-1");
    expect(() => insert.run("thread-chief", "message-1")).toThrow("UNIQUE constraint failed");
    expect(db.prepare("SELECT thread_id, message_id FROM projection_deleted_thread_messages").all()).toEqual([
      { thread_id: "thread-chief", message_id: "message-1" },
    ]);
    db.prepare("DELETE FROM projection_threads WHERE thread_id='thread-chief'").run();
    expect(db.prepare("SELECT * FROM projection_deleted_thread_messages").all()).toEqual([]);
    expectHealthy(db);
  });
});
