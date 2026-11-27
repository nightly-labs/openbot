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

function seedActivities(db: DatabaseSync): void {
  const thread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Chat', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1)`,
  );
  const activity = db.prepare(
    `INSERT INTO projection_thread_activities
       (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
     VALUES (?, ?, 'turn-1', 'conversation.snapshot-updated', ?, '2026-10-01T10:00:00.000Z', ?)`,
  );
  let sequence = 1;
  for (const [threadId, agentId, count] of THREADS) {
    thread.run(threadId, agentId);
    for (let index = 0; index < count; index += 1) {
      sequence += 1;
      const id = index === 0 ? `conversation.snapshot-updated:${sequence}` : `${agentId}-activity-${index}`;
      activity.run(id, threadId, JSON.stringify({ id }), sequence);
    }
  }
}

function contents(db: DatabaseSync) {
  return {
    threads: db.prepare("SELECT * FROM projection_threads ORDER BY thread_id").all(),
    activities: db.prepare("SELECT * FROM projection_thread_activities ORDER BY activity_id").all(),
  };
}

function sequenceIndexColumns(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM pragma_index_info('thread_activities_sequence') ORDER BY seqno")
    .all()
    .map((column) => column.name);
}

function supersededActivityPlan(db: DatabaseSync) {
  return db
    .prepare(
      "EXPLAIN QUERY PLAN DELETE FROM projection_thread_activities WHERE thread_id = ? AND last_event_sequence = ?",
    )
    .all("openbot-thread-agent-chief", 2)
    .map((step) => String(step.detail));
}

function activitiesAt(db: DatabaseSync, threadId: string, sequence: number) {
  return db
    .prepare(
      "SELECT activity_id FROM projection_thread_activities WHERE thread_id = ? AND last_event_sequence = ? ORDER BY activity_id",
    )
    .all(threadId, sequence);
}

function expectUpgraded(db: DatabaseSync, before: ReturnType<typeof contents>): void {
  expect(contents(db)).toEqual(before);
  expect(sequenceIndexColumns(db)).toEqual(["thread_id", "last_event_sequence"]);
  expect(supersededActivityPlan(db).some((detail) => detail.includes("thread_activities_sequence"))).toBe(true);
  expect(activitiesAt(db, "openbot-thread-agent-chief", 2)).toEqual([
    { activity_id: "conversation.snapshot-updated:2" },
  ]);
  expect(activitiesAt(db, "openbot-thread-agent-helper", 6)).toEqual([{ activity_id: "agent-helper-activity-1" }]);
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 71 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("thread activity sequence index migration", () => {
  it.each([8, 40, 65, 69])("upgrades v%i and keeps every thread and activity", (version) => {
    const db = databaseAt(version);
    seedActivities(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
  });

  it("rolls back the index and the marker after a failure, then retries", () => {
    const db = databaseAt(69);
    seedActivities(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 70
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 70 failed");
    expect(sequenceIndexColumns(db)).toEqual([]);
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 70").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
  });

  it("rolls back when the index name is taken, then retries", () => {
    const db = databaseAt(69);
    seedActivities(db);
    const before = contents(db);
    db.exec("CREATE TABLE thread_activities_sequence (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 70 failed");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 70").all()).toEqual([]);
    expect(contents(db)).toEqual(before);
    db.exec("DROP TABLE thread_activities_sequence");
    migrateOpenBotDatabase(db);
    expectUpgraded(db, before);
  });

  it("rejects newer and incomplete migration histories before it adds the index", () => {
    const db = databaseAt(69);
    seedActivities(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(72, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 72; DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(sequenceIndexColumns(db)).toEqual([]);
  });

  it("starts a second time with no change", () => {
    const db = databaseAt(69);
    seedActivities(db);
    migrateOpenBotDatabase(db);
    const after = contents(db);
    migrateOpenBotDatabase(db);
    expectUpgraded(db, after);
  });
});
