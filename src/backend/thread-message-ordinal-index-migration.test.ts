// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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

const THREADS = [
  ["openbot-thread-agent-chief", "agent-chief", 3],
  ["openbot-thread-agent-helper", "agent-helper", 2],
] as const;

function seedMessages(db: DatabaseSync): void {
  const thread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Chat', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1)`,
  );
  const message = db.prepare(
    `INSERT INTO projection_thread_messages
       (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
     VALUES (?, ?, 'turn-1', 'assistant', 'completed', NULL, ?, ?, ?, 2)`,
  );
  for (const [threadId, agentId, count] of THREADS) {
    thread.run(threadId, agentId);
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const id = `${agentId}-message-${ordinal}`;
      message.run(threadId, id, `2026-10-01T10:00:0${ordinal}.000Z`, ordinal, JSON.stringify({ id, text: id }));
    }
  }
}

function contents(db: DatabaseSync) {
  return {
    threads: db.prepare("SELECT * FROM projection_threads ORDER BY thread_id").all(),
    messages: db.prepare("SELECT * FROM projection_thread_messages ORDER BY thread_id, message_id").all(),
  };
}

function ordinalIndexColumns(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM pragma_index_info('thread_messages_ordinal') ORDER BY seqno")
    .all()
    .map((column) => column.name);
}

function nextOrdinalPlan(db: DatabaseSync) {
  return db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM projection_thread_messages WHERE thread_id = ?",
    )
    .all("openbot-thread-agent-chief")
    .map((step) => String(step.detail));
}

function nextOrdinal(db: DatabaseSync, threadId: string) {
  return db
    .prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM projection_thread_messages WHERE thread_id = ?")
    .get(threadId);
}

const ORDINAL_INDEX_COLUMNS = ["thread_id", "ordinal"];

function expectUpgraded(db: DatabaseSync, before: ReturnType<typeof contents>): void {
  expect(contents(db)).toMatchObject(before);
  expect(ordinalIndexColumns(db)).toEqual(ORDINAL_INDEX_COLUMNS);
  expect(nextOrdinalPlan(db).some((detail) => detail.includes("thread_messages_ordinal"))).toBe(true);
  expect(nextOrdinal(db, "openbot-thread-agent-chief")).toEqual({ ordinal: 3 });
  expect(nextOrdinal(db, "openbot-thread-agent-helper")).toEqual({ ordinal: 2 });
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 70 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("thread message ordinal index migration", () => {
  it.each([8, 40, 66])("upgrades v%i and keeps every thread and message", (version) => {
    const db = databaseAt(version);
    seedMessages(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
    if (version === 66) expect(contents(db)).toEqual(before);
  });

  it("rolls back the index and the marker after a failure, then retries", () => {
    const db = databaseAt(66);
    seedMessages(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 67
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 67 failed");
    expect(ordinalIndexColumns(db)).toEqual([]);
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 67").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
  });

  it("rolls back when the index name is taken, then retries", () => {
    const db = databaseAt(66);
    seedMessages(db);
    const before = contents(db);
    db.exec("CREATE TABLE thread_messages_ordinal (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 67 failed");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 67").all()).toEqual([]);
    expect(contents(db)).toEqual(before);
    db.exec("DROP TABLE thread_messages_ordinal");
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
  });

  it("rejects newer and incomplete migration histories before it adds the index", () => {
    const db = databaseAt(66);
    seedMessages(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(71, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 71; DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(ordinalIndexColumns(db)).toEqual([]);
  });
});
