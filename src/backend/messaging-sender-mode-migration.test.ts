// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as senderModeMigration } from "./migrations/0069-messaging-sender-mode";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const SOURCES = Array.from({ length: 18 }, (_, index) => index + 51);

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

function migrateToSenderMode(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > senderModeMigration.version) migrateUpTo(db, senderModeMigration.version);
  else migrateOpenBotDatabase(db);
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO projection_messaging_connections
      (connection_id, platform, workspace_id, workspace_name, enabled, bot_user_id, app_id, orchestrator_agent_id,
       last_error_code, created_at, updated_at)
      VALUES ('connection-1', 'whatsapp', '48600100200', 'Number 界"\\', 1, '48600100200', '48600100200', 'chief',
        NULL, '2026-01-01', '2026-01-01');
    INSERT INTO projection_messaging_allowed_senders (connection_id, sender_id, kind, name, created_at)
      VALUES ('connection-1', '48600100300', 'contact', 'Ana', '2026-01-02'),
             ('connection-1', '120363000000000001@g.us', 'group', 'Branding 界', '2026-01-03');
  `);
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

function withReplyingSenders(before: Contents): Contents {
  return {
    ...before,
    projection_messaging_allowed_senders: (before.projection_messaging_allowed_senders ?? []).map((row) => ({
      ...row,
      mode: "reply",
    })),
  };
}

function columns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info(projection_messaging_allowed_senders)")
    .all()
    .map((column) => String(column.name));
}

function modes(db: DatabaseSync) {
  return db.prepare("SELECT sender_id, mode FROM projection_messaging_allowed_senders ORDER BY sender_id").all();
}

function expectHealthy(db: DatabaseSync, version = senderModeMigration.version): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("messaging sender mode migration", () => {
  it.each(SOURCES)("keeps every row from released schema %i, and every sender still gets replies", (version) => {
    const db = databaseAt(version);
    seed(db);
    if (version < 68) migrateUpTo(db, 68);
    const before = contents(db);
    migrateToSenderMode(db);
    expect(contents(db)).toEqual(withReplyingSenders(before));
    expect(columns(db).at(-1)).toBe("mode");
    expectHealthy(db);
  });

  it("rolls back the column and the marker after a late failure, then retries", () => {
    const db = databaseAt(68);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=69
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 69 failed");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=69").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToSenderMode(db);
    expect(contents(db)).toEqual(withReplyingSenders(before));
    expectHealthy(db);
  });

  it("keeps a column and its value that a development build added before the marker", () => {
    const db = databaseAt(68);
    seed(db);
    db.exec("ALTER TABLE projection_messaging_allowed_senders ADD COLUMN mode TEXT NOT NULL DEFAULT 'reply'");
    db.exec("UPDATE projection_messaging_allowed_senders SET mode='read' WHERE kind='group'");
    migrateToSenderMode(db);
    expect(columns(db).filter((name) => name === "mode")).toEqual(["mode"]);
    expect(modes(db)).toEqual([
      { sender_id: "120363000000000001@g.us", mode: "read" },
      { sender_id: "48600100300", mode: "reply" },
    ]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the column", () => {
    const db = databaseAt(68);
    seed(db);
    const before = contents(db);
    const columnsBefore = columns(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=51");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 51");
    expect(contents(db)).toEqual(before);
    expect(columns(db)).toEqual(columnsBefore);
  });

  it("makes a release before the sender mode refuse a database with a read-only sender", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(senderModeMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(senderModeMigration.version).toBeGreaterThan(olderNewest);

    const db = databaseAt(68);
    seed(db);
    migrateOpenBotDatabase(db);
    db.exec("UPDATE projection_messaging_allowed_senders SET mode='read' WHERE kind='group'");
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

  it("refuses a mode other than reply or read, in an upgraded and in a new database", () => {
    const upgraded = databaseAt(68);
    seed(upgraded);
    migrateOpenBotDatabase(upgraded);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    seed(created);
    for (const db of [upgraded, created]) {
      expect(() => db.exec("UPDATE projection_messaging_allowed_senders SET mode='all' WHERE kind='group'")).toThrow(
        /CHECK constraint failed/u,
      );
      expect(() => db.exec("UPDATE projection_messaging_allowed_senders SET mode=NULL WHERE kind='group'")).toThrow(
        /NOT NULL constraint failed/u,
      );
      db.exec("UPDATE projection_messaging_allowed_senders SET mode='read' WHERE kind='group'");
      expect(modes(db)).toEqual([
        { sender_id: "120363000000000001@g.us", mode: "read" },
        { sender_id: "48600100300", mode: "reply" },
      ]);
      expectHealthy(db, LATEST_SCHEMA_VERSION);
    }
  });
});
