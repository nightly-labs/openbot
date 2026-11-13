// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves the table or
// its marker; a newer or incomplete history is accepted; a ping names a connection that does not exist;
// a person pinged twice in one thread gets two rows. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

// Migration 61 runs after 59 and adds the empty pin table.
const PING_TABLES = { projection_messaging_pings: [], projection_pinned_thread_messages: [] };

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

/** A memory, and from schema 25 on a Slack connection: the rows that migration 59 must keep. */
function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Use the client VPN 界"\\', 'use the client vpn 界"\\', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 25)
    db.prepare(`INSERT INTO projection_messaging_connections
      (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
       last_error_code, created_at, updated_at)
      VALUES ('slack-1', 'slack', 'T1', 'Acme 界', 1, 'UBOT', 'A1', 'chief', NULL, '2026-01-02', '2026-01-02')`).run();
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

/** The source rows, and each agent memory has no site, as migration 60 adds it. */
function withNoMemorySite(before: Contents): Contents {
  return {
    ...before,
    projection_agent_memories: (before.projection_agent_memories ?? []).map((row) => ({ ...row, site: null })),
  };
}

function pingObjects(db: DatabaseSync) {
  return db
    .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'projection_messaging_pings' ORDER BY name")
    .all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 61 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function insertPing(db: DatabaseSync, connectionId: string, text: string): void {
  db.prepare(`INSERT INTO projection_messaging_pings
    (connection_id, platform_channel_id, thread_key, user_id, agent_id, text, created_at)
    VALUES (?, 'C1', '1700000000.000100', 'U1', 'research', ?, '2026-01-03T10:00:00.000Z')
    ON CONFLICT(connection_id, platform_channel_id, thread_key, user_id)
    DO UPDATE SET text = excluded.text`).run(connectionId, text);
}

describe("messaging pings migration", () => {
  it.each(Array.from({ length: 51 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v59 must keep.
      if (version < 58) migrateUpTo(db, 58);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...withNoMemorySite(before), ...PING_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(58);
    seed(db, 58);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=59
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 59 failed");
    expect(contents(db)).toEqual(before);
    expect(pingObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=59").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...withNoMemorySite(before), ...PING_TABLES });
    expect(pingObjects(db)).toEqual([
      { type: "table", name: "projection_messaging_pings" },
      { type: "index", name: "sqlite_autoindex_projection_messaging_pings_1" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(58);
    seed(db, 58);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=62; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(pingObjects(db)).toEqual([]);
  });

  it("refuses a ping of an unknown connection, and keeps one row for a person pinged twice", () => {
    const db = databaseAt(58);
    seed(db, 58);
    migrateOpenBotDatabase(db);
    expect(() => insertPing(db, "missing", "Which logo?")).toThrow("FOREIGN KEY constraint failed");
    insertPing(db, "slack-1", "Which logo?");
    insertPing(db, "slack-1", "Which logo, A or B?");
    expect(db.prepare("SELECT connection_id, user_id, text FROM projection_messaging_pings").all()).toEqual([
      { connection_id: "slack-1", user_id: "U1", text: "Which logo, A or B?" },
    ]);
    expectHealthy(db);
  });
});
