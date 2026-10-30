// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: a migration commits a database with a broken foreign key that it made; a broken foreign key from
// before the upgrade stops a migration that does not touch it, or the upgrade deletes or changes its row; a failed
// migration leaves foreign-key enforcement off; a history with a gap at any version runs the migrations after the gap.
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

function latestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateOpenBotDatabase(db);
  return db;
}

// A message and a turn whose thread and session do not exist. Only a database written with foreign keys off can
// hold them.
function seedOrphans(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
      ordinal, message_json, last_event_sequence)
    VALUES ('openbot-thread-gone', 'message-1', NULL, 'user', 'completed', NULL, '2026-10-01T10:00:00.000Z', 0,
      '{"id":"message-1","text":"Still here."}', 1);
    INSERT INTO projection_threads
      (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('openbot-thread-chief', 'chief', 'Chief', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1);
    INSERT INTO projection_turns
      (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
    VALUES ('turn-1', 'openbot-thread-chief', 'session-gone', 'completed', '2026-10-01T09:00:00.000Z', NULL, 1);`);
  db.exec("PRAGMA foreign_keys = ON");
}

function contents(db: DatabaseSync) {
  return {
    messages: db.prepare("SELECT * FROM projection_thread_messages ORDER BY message_id").all(),
    turns: db.prepare("SELECT * FROM projection_turns ORDER BY turn_id").all(),
  };
}

function versions(db: DatabaseSync): number[] {
  return db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number(row.version));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

describe("migration guards", () => {
  // Migrations 13, 17, 19, 22 to 24, 26 and 28 turn foreign keys off for their rebuilds, and the others do not.
  it.each([9, 13, 17, 19, 22, 23, 24, 26, 28, 39, 40, 43, 44, 45, 46, 47])(
    "runs migration %i past broken foreign keys from before the upgrade",
    (version) => {
      const db = databaseAt(version - 1);
      seedOrphans(db);
      const before = contents(db);
      const violationsBefore = db.prepare("PRAGMA foreign_key_check").all();
      expect(violationsBefore).toHaveLength(2);

      migrateOpenBotDatabase(db);

      expect(versions(db)).toEqual(range(8, 47));
      // Migration 40 adds order columns to the message; every column the row had keeps its value.
      expect(contents(db)).toMatchObject(before);
      // A rebuild moves its table in the schema, which changes only the order of the rows.
      const violationsAfter = db.prepare("PRAGMA foreign_key_check").all();
      expect(violationsAfter).toHaveLength(violationsBefore.length);
      expect(violationsAfter).toEqual(expect.arrayContaining(violationsBefore));
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back a migration that breaks a foreign key, next to one from before the upgrade", () => {
    const db = databaseAt(27);
    seedOrphans(db);
    // Migration 28 runs with foreign keys off. Its transaction deletes the thread of the turn, so the turn gets a
    // second broken reference that the migration made.
    db.exec(`CREATE TEMP TRIGGER break_reference AFTER INSERT ON schema_migrations WHEN new.version = 28
      BEGIN DELETE FROM projection_threads WHERE thread_id = 'openbot-thread-chief'; END;`);
    const before = contents(db);
    const threadsBefore = db.prepare("SELECT * FROM projection_threads").all();
    const schemaBefore = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();

    expect(() => migrateOpenBotDatabase(db)).toThrow(
      expect.objectContaining({
        message: "OpenBot database migration to version 28 failed.",
        cause: expect.objectContaining({
          message:
            "OpenBot database migration produced 1 foreign-key violation(s) in projection_turns -> projection_threads.",
        }),
      }),
    );
    expect(versions(db)).toEqual(range(8, 27));
    expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()).toEqual(schemaBefore);
    expect(db.prepare("SELECT * FROM projection_threads").all()).toEqual(threadsBefore);
    expect(contents(db)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    // The next start meets the same rows and stops again. It deletes nothing to get past them.
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 28 failed");
    expect(contents(db)).toEqual(before);

    db.exec("DROP TRIGGER break_reference");
    migrateOpenBotDatabase(db);
    expect(versions(db)).toEqual(range(8, 47));
    expect(contents(db)).toMatchObject(before);
  });

  it.each(range(8, 46))("rejects a history that is missing version %i and changes nothing", (missing) => {
    const db = latestDatabase();
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(missing);
    const schemaBefore = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();

    expect(() => migrateOpenBotDatabase(db)).toThrow(
      `OpenBot database migration history is missing version ${missing}.`,
    );
    expect(versions(db)).toEqual(range(8, 47).filter((version) => version !== missing));
    expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()).toEqual(schemaBefore);
  });
});
