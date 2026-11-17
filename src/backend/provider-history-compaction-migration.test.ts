// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase, NewerDatabaseError } from "./openbot-database-schema";

// Failure modes: the marker changes or loses a row of any table; a failed upgrade leaves the marker;
// a newer or incomplete history is accepted; a database at version 64 opens in a release that does not
// know compacted provider history items. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
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

/** A memory, and from schema 29 on an imported Codex turn with its staged item in full. */
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

function schema(db: DatabaseSync) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
}

function markers(db: DatabaseSync) {
  return db.prepare("SELECT version FROM schema_migrations WHERE version >= 64").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 64 });
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
      // The earlier migrations run first; the rows and the schema after them are what v64 must keep.
      if (version < 63) migrateUpTo(db, 63);
      const before = contents(db);
      const schemaBefore = schema(db);
      migrateOpenBotDatabase(db);
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
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it writes the marker", () => {
    const db = databaseAt(63);
    seed(db, 63);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(65,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    db.exec("DELETE FROM schema_migrations WHERE version=65; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(markers(db)).toEqual([]);
  });

  // v0.72.0 knows versions up to 63 (`openbot-database-schema.ts:1043,1050` at that tag) and throws
  // `NewerDatabaseError` for a newer one (`:1196`, `:1204-1205`) before it reads a row, so it never reads a
  // compacted item. A version above this build's newest stands in for that older release here.
  it("refuses to open a version 64 database in an older application", () => {
    const db = databaseAt(63);
    seed(db, 63);
    migrateOpenBotDatabase(db);
    db.prepare("UPDATE provider_history_staging SET item_json = ?").run(JSON.stringify(`sha256:${"0".repeat(64)}`));
    const after = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(65,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
    expect(contents(db)).toEqual(after);
  });

  it("stamps the marker on a new database", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    migrateOpenBotDatabase(db);
    expectHealthy(db);
  });
});
