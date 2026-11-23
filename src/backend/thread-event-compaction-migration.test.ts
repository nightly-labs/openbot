// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as progressMigration } from "./migrations/0065-thread-event-compaction";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const NOW = "2026-11-18T10:00:00.000Z";
const PAYLOAD = JSON.stringify({
  threadId: "thread-1",
  changedMessages: [{ id: "message-1", author: "user", text: 'Answer 界"\\', createdAt: NOW }],
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

function migrateToProgressTable(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > 65) migrateUpTo(db, 65);
  else migrateOpenBotDatabase(db);
}

function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Bill Acme 界"\\', 'bill acme 界"\\', 'manual', NULL, '2026-01-01', '2026-01-01', 2)`).run();
  if (version < 29) return;
  db.prepare(`INSERT INTO projection_threads
    (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('thread-1', 'chief', 'Chief', NULL, ?, ?, 1)`).run(NOW, NOW);
  db.prepare(`INSERT INTO orchestration_events
    (sequence, event_id, aggregate_type, aggregate_id, event_type, occurred_at, command_id, payload_json)
    VALUES (1, 'event-1', 'thread', 'thread-1', 'thread.conversation.snapshot-updated', ?, 'command-1', ?)`).run(
    NOW,
    PAYLOAD,
  );
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

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

function schema(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE tbl_name <> 'thread_event_compaction' ORDER BY type, name",
    )
    .all();
}

function progressObjects(db: DatabaseSync) {
  return db
    .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'thread_event_compaction' ORDER BY name")
    .all();
}

function expectHealthy(db: DatabaseSync, version = 65): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("thread event compaction progress migration", () => {
  it.each(Array.from({ length: 57 }, (_, index) => index + 8))(
    "preserves every row and the schema from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      if (version < 64) migrateUpTo(db, 64);
      const before = contents(db);
      const schemaBefore = schema(db);
      migrateToProgressTable(db);
      expect(contents(db)).toEqual({ ...before, thread_event_compaction: [] });
      expect(schema(db)).toEqual(schemaBefore);
      if (version >= 29)
        expect(db.prepare("SELECT payload_json FROM orchestration_events").all()).toEqual([{ payload_json: PAYLOAD }]);
      expectHealthy(db);
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(64);
    seed(db, 64);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=65
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 65 failed");
    expect(contents(db)).toEqual(before);
    expect(progressObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=65").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToProgressTable(db);
    expect(contents(db)).toEqual({ ...before, thread_event_compaction: [] });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the table", () => {
    const db = databaseAt(64);
    seed(db, 64);
    const before = contents(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(progressObjects(db)).toEqual([]);
  });

  it("deletes the progress of a thread with the thread", () => {
    const db = databaseAt(64);
    seed(db, 64);
    migrateToProgressTable(db);
    db.prepare("INSERT INTO thread_event_compaction VALUES ('thread-1', 1, ?)").run(NOW);
    expect(() => db.prepare("INSERT INTO thread_event_compaction VALUES ('thread-2', 1, ?)").run(NOW)).toThrow(
      "FOREIGN KEY",
    );
    db.exec("DELETE FROM projection_threads WHERE thread_id = 'thread-1'");
    expect(db.prepare("SELECT * FROM thread_event_compaction").all()).toEqual([]);
    expectHealthy(db);
  });

  it("makes a release before compaction refuse a database with compacted events", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(progressMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(progressMigration.version).toBeGreaterThan(olderNewest);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(progressMigration.version);

    const db = databaseAt(64);
    seed(db, 64);
    migrateOpenBotDatabase(db);
    db.prepare("INSERT INTO thread_event_compaction VALUES ('thread-1', 1, ?)").run(NOW);
    const after = contents(db);

    vi.resetModules();
    vi.doMock("./migrations/registry", async (importOriginal) => {
      const registry = await importOriginal<typeof Registry>();
      return { ...registry, MIGRATIONS: registry.MIGRATIONS.filter((entry) => entry.version <= olderNewest) };
    });
    const older = await import("./openbot-database-schema");
    expect(older.LATEST_SCHEMA_VERSION).toBe(olderNewest);
    expect(() => older.migrateOpenBotDatabase(db)).toThrow(older.NewerDatabaseError);
    expect(contents(db)).toEqual(after);
  });

  it("adds the empty table to a new database", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    migrateOpenBotDatabase(db);
    expect(progressObjects(db)).toEqual([
      { type: "index", name: "sqlite_autoindex_thread_event_compaction_1" },
      { type: "table", name: "thread_event_compaction" },
    ]);
    expect(db.prepare("SELECT * FROM thread_event_compaction").all()).toEqual([]);
    expectHealthy(db, LATEST_SCHEMA_VERSION);
  });
});
