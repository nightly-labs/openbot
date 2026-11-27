// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as syncChangeMigration } from "./migrations/0071-sync-change-sequence";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const PREVIOUS = syncChangeMigration.version - 1;
const SOURCES = [8, 17, 18, 39, 40, 41, 66, 67, 68, PREVIOUS];
const CHANNEL_TABLES_VERSION = 18;
const SYNC_OBJECTS = [
  "index sync_message_changes_owner",
  "table sync_message_changes",
  "trigger sync_channel_changes_forget",
  "trigger sync_channel_message_delete",
  "trigger sync_channel_message_insert",
  "trigger sync_channel_message_update",
  "trigger sync_thread_changes_forget",
  "trigger sync_thread_message_delete",
  "trigger sync_thread_message_insert",
  "trigger sync_thread_message_update",
];

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

function migrateToSyncChanges(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > syncChangeMigration.version) migrateUpTo(db, syncChangeMigration.version);
  else migrateOpenBotDatabase(db);
}

function seedThreads(db: DatabaseSync): void {
  const thread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Chat 界', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1)`,
  );
  const message = db.prepare(
    `INSERT INTO projection_thread_messages
       (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
     VALUES (?, ?, 'turn-1', 'assistant', 'completed', NULL, ?, ?, ?, 2)`,
  );
  for (const { threadId, agentId } of [
    { threadId: "thread-chief", agentId: "agent-chief" },
    { threadId: "thread-helper", agentId: "agent-helper" },
  ]) {
    thread.run(threadId, agentId);
    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      const id = `${agentId}-message-${ordinal}`;
      message.run(
        threadId,
        id,
        `2026-10-01T10:00:0${ordinal}.000Z`,
        ordinal,
        JSON.stringify({ id, text: `Hello "${id}" 界\\`, reactions: [{ emoji: "👍", count: 1 }] }),
      );
    }
  }
}

function seedChannels(db: DatabaseSync): void {
  db.prepare("INSERT INTO projection_channels (channel_id, channel_json) VALUES (?, ?)").run(
    "channel-1",
    JSON.stringify({ id: "channel-1", name: "Project 界" }),
  );
  const message = db.prepare(
    "INSERT INTO projection_channel_messages (channel_id, message_id, sequence, message_json) VALUES (?, ?, ?, ?)",
  );
  message.run("channel-1", "channel-message-1", 1, JSON.stringify({ id: "channel-message-1", text: "One" }));
  message.run(
    "channel-1",
    "channel-message-2",
    2,
    JSON.stringify({ id: "channel-message-2", text: "Two", deleted: true }),
  );
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name NOT IN ('schema_migrations', 'sync_message_changes') AND name NOT LIKE 'agent_memory_search%'
       ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function syncObjects(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT type || ' ' || name AS object FROM sqlite_master WHERE name LIKE 'sync\\_%' ESCAPE '\\' ORDER BY 1",
    )
    .all()
    .map((row) => String(row.object));
}

function changes(db: DatabaseSync) {
  return db
    .prepare("SELECT sequence, scope, owner_id, message_id, deleted FROM sync_message_changes ORDER BY sequence")
    .all();
}

function lastSequence(db: DatabaseSync) {
  return db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sync_message_changes'").get();
}

function expectHealthy(db: DatabaseSync, version = syncChangeMigration.version): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function upgradedFrom(version: number): DatabaseSync {
  const db = databaseAt(version);
  seedThreads(db);
  if (version < CHANNEL_TABLES_VERSION) migrateUpTo(db, CHANNEL_TABLES_VERSION);
  seedChannels(db);
  return db;
}

function recordsEachChange(db: DatabaseSync): void {
  const baseline = Number(lastSequence(db)?.seq ?? 0);
  const at = (offset: number) => baseline + offset;
  db.exec(`
    UPDATE projection_thread_messages SET last_event_sequence = last_event_sequence + 1
      WHERE thread_id = 'thread-chief' AND message_id = 'agent-chief-message-2';
    INSERT INTO projection_channel_messages
      SELECT channel_id, message_id, sequence, message_json FROM projection_channel_messages
      WHERE channel_id = 'channel-1' AND message_id = 'channel-message-2'
      ON CONFLICT(channel_id, message_id) DO UPDATE SET sequence = excluded.sequence, message_json = excluded.message_json;
  `);
  expect(changes(db)).toEqual([]);
  db.exec(`
    INSERT INTO projection_thread_messages
      (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
      VALUES ('thread-chief', 'agent-chief-message-new', 'turn-2', 'user', 'completed', NULL,
        '2026-10-02T10:00:00.000Z', 9, '{"id":"agent-chief-message-new"}', 3);
    UPDATE projection_thread_messages SET message_json = '{"id":"agent-chief-message-0","reactions":[]}'
      WHERE thread_id = 'thread-chief' AND message_id = 'agent-chief-message-0';
    INSERT OR IGNORE INTO projection_thread_messages
      (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
      VALUES ('thread-chief', 'agent-chief-message-1', 'turn-1', 'assistant', 'completed', NULL,
        '2026-10-01T10:00:01.000Z', 1, '{"id":"ignored"}', 4);
    DELETE FROM projection_thread_messages WHERE thread_id = 'thread-helper' AND message_id = 'agent-helper-message-2';
    INSERT INTO projection_channel_messages VALUES ('channel-1', 'channel-message-1', 1, '{"id":"channel-message-1","deleted":true}')
      ON CONFLICT(channel_id, message_id) DO UPDATE SET message_json = excluded.message_json;
    INSERT OR REPLACE INTO projection_thread_messages
      (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
      VALUES ('thread-chief', 'agent-chief-message-new', 'turn-2', 'user', 'completed', NULL,
        '2026-10-02T10:00:00.000Z', 9, '{"id":"agent-chief-message-new","text":"edited"}', 5);
  `);
  expect(changes(db)).toEqual([
    { sequence: at(2), scope: "thread", owner_id: "thread-chief", message_id: "agent-chief-message-0", deleted: 0 },
    { sequence: at(3), scope: "thread", owner_id: "thread-helper", message_id: "agent-helper-message-2", deleted: 1 },
    { sequence: at(4), scope: "channel", owner_id: "channel-1", message_id: "channel-message-1", deleted: 0 },
    { sequence: at(5), scope: "thread", owner_id: "thread-chief", message_id: "agent-chief-message-new", deleted: 0 },
  ]);

  db.exec(`
    DELETE FROM projection_threads WHERE thread_id = 'thread-chief';
    DELETE FROM projection_channel_messages WHERE channel_id = 'channel-1';
    DELETE FROM projection_channels WHERE channel_id = 'channel-1';
  `);
  expect(changes(db)).toEqual([
    { sequence: at(3), scope: "thread", owner_id: "thread-helper", message_id: "agent-helper-message-2", deleted: 1 },
  ]);
  expect(Number(lastSequence(db)?.seq)).toBeGreaterThan(at(5));
  expect(db.prepare("SELECT COUNT(*) AS count FROM projection_thread_messages").get()).toEqual({ count: 2 });
}

describe("sync change sequence migration", () => {
  it.each(SOURCES)("keeps every row from released schema %i and starts with no recorded change", (version) => {
    const db = upgradedFrom(version);
    if (version < PREVIOUS) migrateUpTo(db, PREVIOUS);
    const before = contents(db);
    migrateToSyncChanges(db);
    expect(contents(db)).toEqual(before);
    expect(syncObjects(db)).toEqual(SYNC_OBJECTS);
    expect(changes(db)).toEqual([]);
    expectHealthy(db);
  });

  it("gives each write, edit, reaction and delete a new sequence, and none to a rewrite with the same content", () => {
    const upgraded = upgradedFrom(PREVIOUS);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seedThreads(created);
    seedChannels(created);
    created.exec("DELETE FROM sync_message_changes");
    for (const db of [upgraded, created]) {
      recordsEachChange(db);
      expectHealthy(db, LATEST_SCHEMA_VERSION);
    }
    expect(syncObjects(created)).toEqual(syncObjects(upgraded));
  });

  it("rolls back the table, the triggers and the marker after a late failure, then retries", () => {
    const db = upgradedFrom(PREVIOUS);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=${syncChangeMigration.version}
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${syncChangeMigration.version} failed`);
    expect(contents(db)).toEqual(before);
    expect(syncObjects(db)).toEqual([]);
    expect(
      db.prepare("SELECT version FROM schema_migrations WHERE version = ?").all(syncChangeMigration.version),
    ).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToSyncChanges(db);
    expect(contents(db)).toEqual(before);
    expect(syncObjects(db)).toEqual(SYNC_OBJECTS);
    expectHealthy(db);
  });

  it("rolls back when the index name is taken, then retries", () => {
    const db = upgradedFrom(PREVIOUS);
    const before = contents(db);
    db.exec("CREATE TABLE sync_message_changes_owner (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${syncChangeMigration.version} failed`);
    expect(
      db.prepare("SELECT version FROM schema_migrations WHERE version = ?").all(syncChangeMigration.version),
    ).toEqual([]);
    expect(syncObjects(db)).toEqual(["table sync_message_changes_owner"]);
    db.exec("DROP TABLE sync_message_changes_owner");
    expect(contents(db)).toEqual(before);
    migrateToSyncChanges(db);
    expect(contents(db)).toEqual(before);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the table", () => {
    const db = upgradedFrom(PREVIOUS);
    const before = contents(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(syncObjects(db)).toEqual([]);
  });

  it("makes a release before the change sequence refuse the upgraded database and keep its rows", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(syncChangeMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(syncChangeMigration.version).toBeGreaterThan(olderNewest);

    const db = upgradedFrom(PREVIOUS);
    migrateOpenBotDatabase(db);
    db.exec("UPDATE projection_thread_messages SET status = 'failed' WHERE message_id = 'agent-chief-message-2'");
    const after = contents(db);
    const recorded = changes(db);

    vi.resetModules();
    vi.doMock("./migrations/registry", async (importOriginal) => {
      const registry = await importOriginal<typeof Registry>();
      return { ...registry, MIGRATIONS: registry.MIGRATIONS.filter((entry) => entry.version <= olderNewest) };
    });
    const older = await import("./openbot-database-schema");
    expect(older.LATEST_SCHEMA_VERSION).toBe(olderNewest);
    expect(() => older.migrateOpenBotDatabase(db)).toThrow(older.NewerDatabaseError);
    expect(contents(db)).toEqual(after);
    expect(changes(db)).toEqual(recorded);
  });
});
