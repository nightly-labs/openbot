// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedDatabaseCases } from "./migration-harness";
import { migration as compactionMigration } from "./migrations/0064-provider-history-compaction";
import type * as Registry from "./migrations/registry";
import { LATEST_SCHEMA_VERSION, migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.doUnmock("./migrations/registry");
  vi.resetModules();
});

const NOW = "2026-11-18T10:00:00.000Z";
const ITEM = '{"type":"agentMessage","id":"item-1","text":"Answer 界\\"\\\\"}';

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

function migrateToCompactionMarker(db: DatabaseSync): void {
  if (LATEST_SCHEMA_VERSION > 64) migrateUpTo(db, 64);
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
  db.prepare(`INSERT INTO provider_history_imports
    (session_id, thread_id, provider, external_session_id, cursor_json, state, created_at, updated_at)
    VALUES ('session-1', 'thread-1', 'codex', 'codex-1', NULL, 'complete', ?, ?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO provider_history_turns
    (session_id, turn_id, turn_status, turn_started_at, complete, imported, updated_at)
    VALUES ('session-1', 'turn-1', 'completed', 1, 1, 1, ?)`).run(NOW);
  db.prepare(`INSERT INTO provider_history_staging
    (session_id, turn_id, item_key, item_index, item_json, imported, updated_at)
    VALUES ('session-1', 'turn-1', 'item-1', 0, ?, 1, ?)`).run(ITEM, NOW);
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
  return db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
}

function markers(db: DatabaseSync) {
  return db.prepare("SELECT version FROM schema_migrations WHERE version = 64").all();
}

function expectHealthy(db: DatabaseSync, version = 64): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("provider history compaction marker migration", () => {
  it.each(Array.from({ length: 56 }, (_, index) => index + 8))(
    "preserves every row and the schema from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      if (version < 63) migrateUpTo(db, 63);
      const before = contents(db);
      const schemaBefore = schema(db);
      migrateToCompactionMarker(db);
      expect(contents(db)).toEqual(before);
      expect(schema(db)).toEqual(schemaBefore);
      if (version >= 29)
        expect(db.prepare("SELECT item_json FROM provider_history_staging").all()).toEqual([{ item_json: ITEM }]);
      expectHealthy(db);
    },
  );

  it("rolls back the marker after a late failure, then retries", () => {
    const db = databaseAt(63);
    seed(db, 63);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=64
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 64 failed");
    expect(contents(db)).toEqual(before);
    expect(markers(db)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateToCompactionMarker(db);
    expect(contents(db)).toEqual(before);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it writes the marker", () => {
    const db = databaseAt(63);
    seed(db, 63);
    const before = contents(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, 'now')").run(LATEST_SCHEMA_VERSION + 1);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION + 1);
    db.exec("DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(markers(db)).toEqual([]);
  });

  it("makes a release before compaction refuse a database with a compacted item", async () => {
    const olderNewest = Math.max(
      ...releasedDatabaseCases()
        .filter((release) => !release.migrations.includes(compactionMigration.version))
        .flatMap((release) => release.migrations),
    );
    expect(compactionMigration.version).toBeGreaterThan(olderNewest);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(compactionMigration.version);

    const db = databaseAt(63);
    seed(db, 63);
    migrateOpenBotDatabase(db);
    db.prepare("UPDATE provider_history_staging SET item_json = ?").run(JSON.stringify(`sha256:${"0".repeat(64)}`));
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

  it("stamps the marker on a new database", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    migrateOpenBotDatabase(db);
    expect(markers(db)).toEqual([{ version: 64 }]);
    expectHealthy(db, LATEST_SCHEMA_VERSION);
  });
});
