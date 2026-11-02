// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves a table or its
// marker; a newer or incomplete history is accepted; a task can point to no thread, or two tasks to one
// thread; a deleted thread leaves its task behind; a task takes an origin or an outcome that the runtime
// does not know. These fixtures cover each. They stop at version 46: migration 47 moves tasks to side
// threads, and `agent-thread-migration.test.ts` covers it.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const TASK_TABLES = {
  projection_agent_tasks: [],
  projection_messaging_allowed_roles: [],
  browser_profiles: [],
  workflow_edges: [],
  workflow_nodes: [],
  workflow_output_deliveries: [],
  workflow_runs: [],
  workflow_steps: [],
  workflow_trigger_webhooks: [],
  workflow_triggers: [],
  workflow_versions: [],
  workflow_webhook_receipts: [],
  workflows: [],
};

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

/** The agent's own chat and a second thread, in the columns every release has. */
function seed(db: DatabaseSync): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  insert.run("openbot-thread-task", "Billing export", "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z");
}

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

function taskTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'projection_agent_task%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db);
  return db;
}

function insertTask(
  db: DatabaseSync,
  values: { taskId?: string; threadId?: string; origin?: string; outcome?: string | null } = {},
): void {
  db.prepare(`INSERT INTO projection_agent_tasks
    (task_id, agent_id, thread_id, origin, title, outcome, created_at, updated_at, closed_at, last_event_sequence)
    VALUES (?, 'chief', ?, ?, 'Billing export', ?, '2026-10-01', '2026-10-01', NULL, 2)`).run(
    values.taskId ?? "task-1",
    values.threadId ?? "openbot-thread-task",
    values.origin ?? "user",
    values.outcome ?? null,
  );
}

describe("agent task migration", () => {
  it.each(Array.from({ length: 30 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // The earlier migrations run first; the rows after them are what v38 must keep.
      if (version < 37) migrateUpTo(db, 37);
      const before = contents(db);
      migrateUpTo(db, 46);
      expect(contents(db)).toEqual({ ...before, ...TASK_TABLES });
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 46 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(37);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=38
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 38 failed");
    expect(contents(db)).toEqual(before);
    expect(taskTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=38").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateUpTo(db, 46);
    expect(contents(db)).toEqual({ ...before, ...TASK_TABLES });
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAtWithSeed(37);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(50,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=50; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(taskTables(db)).toEqual([]);
  });

  it("refuses a task of no thread, a second task of one thread, and an unknown value", () => {
    const db = databaseAtWithSeed(37);
    migrateUpTo(db, 46);
    expect(() => insertTask(db, { threadId: "openbot-thread-unknown" })).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertTask(db, { origin: "routine" })).toThrow("CHECK constraint failed");
    expect(() => insertTask(db, { outcome: "cancelled" })).toThrow("CHECK constraint failed");
    insertTask(db, { outcome: "completed" });
    expect(() => insertTask(db, { taskId: "task-2" })).toThrow("UNIQUE constraint failed");
    expect(db.prepare("SELECT task_id, outcome, error FROM projection_agent_tasks").all()).toEqual([
      { task_id: "task-1", outcome: "completed", error: null },
    ]);
  });

  it("deletes the task with the task's thread, and keeps the agent's own chat", () => {
    const db = databaseAtWithSeed(37);
    migrateUpTo(db, 46);
    insertTask(db);
    db.prepare("DELETE FROM projection_threads WHERE thread_id='openbot-thread-task'").run();
    expect(db.prepare("SELECT task_id FROM projection_agent_tasks").all()).toEqual([]);
    expect(db.prepare("SELECT thread_id FROM projection_threads").all()).toEqual([
      { thread_id: "openbot-thread-chief" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
