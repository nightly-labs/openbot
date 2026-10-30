// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses or changes an event or a receipt; a partial migration survives a failure;
// a retry fails on the index that the failed run left; a newer or incomplete history is changed.
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

// A thread snapshot, two flushes of one streamed message, and a hosted-site event, each with its receipt.
function seedEvents(db: DatabaseSync): void {
  db.exec(`INSERT INTO orchestration_events
      (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
    VALUES
      ('event-1', 'command-1', 'thread', 'openbot-thread-chief', 'conversation.snapshot',
        '2026-10-01T10:00:00.000Z', '{"snapshot":{"messages":[]}}'),
      ('event-2', 'command-2', 'thread', 'openbot-thread-chief', 'conversation.message-streamed',
        '2026-10-01T10:00:01.000Z', '{"streamedMessage":{"id":"message-1","text":"Hel"}}'),
      ('event-3', 'command-3', 'thread', 'openbot-thread-chief', 'conversation.message-streamed',
        '2026-10-01T10:00:02.000Z', '{"streamedMessage":{"id":"message-1","text":"Hello"}}'),
      ('event-4', 'command-4', 'hosted-site-operation', 'site-1', 'hosted-site.active',
        '2026-10-01T10:00:03.000Z', '{"siteId":"site-1"}');
    INSERT INTO orchestration_command_receipts (command_id, accepted_at, first_sequence, last_sequence, result_json)
      SELECT command_id, occurred_at, sequence, sequence, '{}' FROM orchestration_events;`);
}

function contents(db: DatabaseSync) {
  return {
    events: db.prepare("SELECT * FROM orchestration_events ORDER BY sequence").all(),
    receipts: db.prepare("SELECT * FROM orchestration_command_receipts ORDER BY command_id").all(),
  };
}

function typeIndexColumns(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM pragma_index_info('orchestration_events_thread_type') ORDER BY seqno")
    .all()
    .map((column) => column.name);
}

const TYPE_INDEX_COLUMNS = ["aggregate_id", "event_type", "sequence"];

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("event type index migration", () => {
  // The event table is the same from the v8 baseline on, so the oldest and the newest released schema bound it.
  it.each([8, 42])("upgrades v%i and keeps every event and receipt", (version) => {
    const db = databaseAt(version);
    seedEvents(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expect(typeIndexColumns(db)).toEqual(TYPE_INDEX_COLUMNS);
    expectHealthy(db);
  });

  it("rolls back the index and the marker after a failure, then retries", () => {
    const db = databaseAt(42);
    seedEvents(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 43
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 43 failed");
    expect(typeIndexColumns(db)).toEqual([]);
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 43").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expect(typeIndexColumns(db)).toEqual(TYPE_INDEX_COLUMNS);
    expectHealthy(db);
  });

  it("rolls back when the index name is taken, then retries", () => {
    const db = databaseAt(42);
    seedEvents(db);
    const before = contents(db);
    // SQLite refuses an index whose name a table holds, even with IF NOT EXISTS.
    db.exec("CREATE TABLE orchestration_events_thread_type (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 43 failed");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 43").all()).toEqual([]);
    expect(contents(db)).toEqual(before);
    db.exec("DROP TABLE orchestration_events_thread_type");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expect(typeIndexColumns(db)).toEqual(TYPE_INDEX_COLUMNS);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the index", () => {
    const db = databaseAt(42);
    seedEvents(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(48, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 48; DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(typeIndexColumns(db)).toEqual([]);
  });
});
