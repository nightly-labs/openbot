// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table, an
// index or its marker; a newer or incomplete history is accepted; a saved message names a connection
// that does not exist; one message is saved twice; a VACUUM changes the order of the saved messages.
// These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const HISTORY_TABLES = { projection_messaging_history: [] };

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

/** A memory, and from schema 25 on a messaging connection: the rows that migration 62 must keep. */
function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Use the client VPN 界"\\', 'use the client vpn 界"\\', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 25)
    db.prepare(`INSERT INTO projection_messaging_connections
      (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
       last_error_code, created_at, updated_at)
      VALUES ('connection-1', 'slack', 'T1', 'Acme 界', 1, 'UBOT', 'A1', 'chief', NULL, '2026-01-02', '2026-01-02')`).run();
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

function historyObjects(db: DatabaseSync) {
  return db
    .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'projection_messaging_history' ORDER BY name")
    .all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 62 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function insertMessage(db: DatabaseSync, connectionId: string, messageId: string, text: string): void {
  db.prepare(`INSERT INTO projection_messaging_history
    (connection_id, platform_channel_id, message_id, thread_key, author_id, author_name, text, sent_at, files_json,
      saved_at)
    VALUES (?, '120363000000000000@g.us', ?, 'direct', '48600100200', 'Ana 界', ?, '2026-01-03T10:00:00.000Z', '[]',
      '2026-01-03T10:00:01.000Z')
    ON CONFLICT(connection_id, platform_channel_id, message_id) DO NOTHING`).run(connectionId, messageId, text);
}

describe("messaging history migration", () => {
  it.each(Array.from({ length: 54 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v62 must keep.
      if (version < 61) migrateUpTo(db, 61);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...HISTORY_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the table, its indexes and the marker after a late failure, then retries", () => {
    const db = databaseAt(61);
    seed(db, 61);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=62
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 62 failed");
    expect(contents(db)).toEqual(before);
    expect(historyObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=62").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...HISTORY_TABLES });
    expect(historyObjects(db)).toEqual([
      { type: "index", name: "idx_projection_messaging_history_place" },
      { type: "index", name: "idx_projection_messaging_history_saved" },
      { type: "index", name: "idx_projection_messaging_history_sent" },
      { type: "table", name: "projection_messaging_history" },
      { type: "index", name: "sqlite_autoindex_projection_messaging_history_1" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(61);
    seed(db, 61);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(63,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=63; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(historyObjects(db)).toEqual([]);
  });

  it("refuses a message of an unknown connection, saves a message once, and keeps the order after a VACUUM", () => {
    const db = databaseAt(61);
    seed(db, 61);
    migrateOpenBotDatabase(db);
    expect(() => insertMessage(db, "missing", "m1", "Hello")).toThrow("FOREIGN KEY constraint failed");
    insertMessage(db, "connection-1", "m2", "First 界");
    insertMessage(db, "connection-1", "m1", "Second");
    insertMessage(db, "connection-1", "m2", "A copy of the first");
    db.exec("DELETE FROM projection_messaging_history WHERE message_id = 'm2'");
    insertMessage(db, "connection-1", "m3", "Third");
    db.exec("VACUUM");
    expect(db.prepare("SELECT message_id, text FROM projection_messaging_history ORDER BY seq").all()).toEqual([
      { message_id: "m1", text: "Second" },
      { message_id: "m3", text: "Third" },
    ]);
    expectHealthy(db);
  });
});
