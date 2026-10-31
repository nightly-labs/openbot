// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a task does not become a thread, or
// loses a column; a task row with no thread stops the upgrade; a failed upgrade leaves the new table, or
// drops the task table; a newer or incomplete history is accepted; a queued message that names its task
// no longer finds the thread; a thread can point to no conversation, or two threads to one task; a
// deleted conversation leaves its thread behind. These fixtures cover each.
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

/** The agent's own chat and two task conversations, in the columns every release has. */
function seedThreads(db: DatabaseSync): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  insert.run("openbot-thread-open", "Billing export", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z");
  insert.run("openbot-thread-closed", "Release notes", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z");
}

/** An open task of the person, and a closed, failed task that the agent started. From schema 38 on. */
function seedTasks(db: DatabaseSync): void {
  db.exec(`INSERT INTO projection_agent_tasks
    (task_id, agent_id, thread_id, origin, title, outcome, error, created_at, updated_at, closed_at,
     last_event_sequence)
    VALUES ('agent-task-open', 'chief', 'openbot-thread-open', 'user', 'Billing export 界"\\', 'completed', NULL,
        '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', NULL, 4),
      ('agent-task-closed', 'chief', 'openbot-thread-closed', 'agent', 'Release notes', 'failed', 'Provider said no',
        '2026-10-01T09:00:00.000Z', '2026-10-02T09:00:00.000Z', '2026-10-03T09:00:00.000Z', 7)`);
}

// Migration 48 adds the branch link, null for every moved task.
const THREADS = [
  {
    thread_id: "openbot-thread-closed",
    agent_id: "chief",
    legacy_task_id: "agent-task-closed",
    origin: "agent",
    title: "Release notes",
    title_source: "agent",
    outcome: "failed",
    error: "Provider said no",
    created_at: "2026-10-01T09:00:00.000Z",
    updated_at: "2026-10-02T09:00:00.000Z",
    archived_at: "2026-10-03T09:00:00.000Z",
    last_event_sequence: 7,
    branch_source_thread_id: null,
    branch_source_message_id: null,
    branch_through_message_id: null,
  },
  {
    thread_id: "openbot-thread-open",
    agent_id: "chief",
    legacy_task_id: "agent-task-open",
    origin: "user",
    title: 'Billing export 界"\\',
    title_source: "auto",
    outcome: "completed",
    error: null,
    created_at: "2026-10-01T08:00:00.000Z",
    updated_at: "2026-10-02T08:00:00.000Z",
    archived_at: null,
    last_event_sequence: 4,
    branch_source_thread_id: null,
    branch_source_message_id: null,
    branch_through_message_id: null,
  },
];

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function threads(db: DatabaseSync): unknown[] {
  return db.prepare("SELECT * FROM projection_agent_threads ORDER BY thread_id").all();
}

function agentTables(db: DatabaseSync): unknown[] {
  return db
    .prepare(
      "SELECT type, name FROM sqlite_master WHERE name LIKE '%agent_t%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
}

/** The rows that migration 47 must keep: every table except the task table, which becomes the thread table. */
function withoutTasks(rows: Record<string, unknown[]>): Record<string, unknown[]> {
  const { projection_agent_tasks: _tasks, projection_agent_threads: _threads, ...kept } = rows;
  return kept;
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 48 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function insertThread(
  db: DatabaseSync,
  values: { threadId?: string; legacyTaskId?: string | null; origin?: string; titleSource?: string } = {},
): void {
  db.prepare(`INSERT INTO projection_agent_threads
    (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error, created_at, updated_at,
     archived_at, last_event_sequence)
    VALUES (?, 'chief', ?, ?, 'Billing export', ?, NULL, NULL, '2026-10-04', '2026-10-04', NULL, 9)`).run(
    values.threadId ?? "openbot-thread-new",
    values.legacyTaskId ?? null,
    values.origin ?? "user",
    values.titleSource ?? "user",
  );
}

describe("agent thread migration", () => {
  it.each(Array.from({ length: 39 }, (_, index) => index + 8))(
    "moves every task to a thread and keeps every other row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seedThreads(db);
      // The earlier migrations run first; the rows after them are what v47 must keep.
      if (version < 38) migrateUpTo(db, 38);
      seedTasks(db);
      if (version < 46) migrateUpTo(db, 46);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(withoutTasks(contents(db))).toEqual(withoutTasks(before));
      expect(threads(db)).toEqual(THREADS);
      expect(agentTables(db)).toEqual([
        { type: "index", name: "agent_threads_agent" },
        { type: "index", name: "agent_threads_open" },
        { type: "table", name: "projection_agent_threads" },
      ]);
      expectHealthy(db);
    },
  );

  it("skips a task row whose conversation is gone, so the upgrade completes", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    db.exec("PRAGMA foreign_keys=OFF; DELETE FROM projection_threads WHERE thread_id='openbot-thread-closed'");
    db.exec("PRAGMA foreign_keys=ON");
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_agent_tasks").get()).toEqual({ count: 2 });
    migrateOpenBotDatabase(db);
    expect(threads(db)).toEqual([THREADS[1]]);
    expectHealthy(db);
  });

  it("keeps the task id of a queued message, and the thread answers to it", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    const message = JSON.stringify({ id: "message-1", taskId: "agent-task-open", text: "Next step" });
    db.prepare(`INSERT INTO projection_mailbox_messages
      (message_id, sender_kind, sender_agent_id, text, reply_to_message_id, created_at, message_json, last_event_sequence)
      VALUES ('message-1', 'user', NULL, 'Next step', NULL, '2026-10-04', ?, 10)`).run(message);
    db.exec(`INSERT INTO projection_deliveries
      (delivery_id, message_id, recipient_agent_id, status, turn_id, error, created_at, delivery_json, last_event_sequence)
      VALUES ('delivery-1', 'message-1', 'chief', 'queued', NULL, NULL, '2026-10-04', '{"id":"delivery-1"}', 10)`);
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT message_json FROM projection_mailbox_messages").all()).toEqual([
      { message_json: message },
    ]);
    expect(
      db
        .prepare(
          `SELECT thread_id FROM projection_agent_threads
           WHERE legacy_task_id = ? OR (legacy_task_id IS NULL AND thread_id = ?)`,
        )
        .all("agent-task-open", "agent-task-open"),
    ).toEqual([{ thread_id: "openbot-thread-open" }]);
    expectHealthy(db);
  });

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    const before = contents(db);
    const tablesBefore = agentTables(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=47
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 47 failed");
    expect(contents(db)).toEqual(before);
    expect(agentTables(db)).toEqual(tablesBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=47").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(threads(db)).toEqual(THREADS);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it moves the tasks", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(49,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=49; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
  });

  it("refuses a thread of no conversation, a second thread of one task, and an unknown value", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    migrateOpenBotDatabase(db);
    db.prepare(
      "INSERT INTO projection_threads VALUES ('openbot-thread-new', 'chief', 'Chief', NULL, '2026-10-04', '2026-10-04', 9)",
    ).run();
    expect(() => insertThread(db, { threadId: "openbot-thread-unknown" })).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertThread(db, { origin: "routine" })).toThrow("CHECK constraint failed");
    expect(() => insertThread(db, { titleSource: "channel" })).toThrow("CHECK constraint failed");
    expect(() => insertThread(db, { legacyTaskId: "agent-task-open" })).toThrow("UNIQUE constraint failed");
    expect(() => insertThread(db, { threadId: "openbot-thread-open" })).toThrow("UNIQUE constraint failed");
    insertThread(db);
    expect(threads(db)).toHaveLength(3);
  });

  it("deletes the thread with its conversation, and keeps the agent's own chat", () => {
    const db = databaseAt(46);
    seedThreads(db);
    seedTasks(db);
    migrateOpenBotDatabase(db);
    db.exec("DELETE FROM projection_threads WHERE thread_id IN ('openbot-thread-open', 'openbot-thread-closed')");
    expect(threads(db)).toEqual([]);
    expect(db.prepare("SELECT thread_id FROM projection_threads").all()).toEqual([
      { thread_id: "openbot-thread-chief" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
