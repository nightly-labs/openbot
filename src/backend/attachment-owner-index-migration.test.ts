// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses or changes an attachment; a partial migration survives a failure; a retry
// fails on the index that the failed run left; a newer or incomplete history is changed.
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

// One row of each owner kind that the app writes.
function seedAttachments(db: DatabaseSync): void {
  db.exec(`INSERT INTO projection_attachments
      (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
    VALUES
      ('openbot-thread-chief:message-1:file-1', 'thread-message', 'openbot-thread-chief:message-1', 'notes.md', '',
        '{"id":"file-1","name":"notes.md"}', '2026-10-01T10:00:00.000Z', 3),
      ('openbot-thread-chief:message-2:file-2', 'thread-message', 'openbot-thread-chief:message-2', 'plot.png', '',
        '{"id":"file-2","name":"plot.png"}', '2026-10-01T10:01:00.000Z', 4),
      ('draft-1', 'draft', 'agent-chief', 'draft.txt', '/drafts/draft.txt',
        '{"id":"draft-1"}', '2026-10-01T10:02:00.000Z', 5),
      ('generated-1', 'generated', 'mailbox-message-1', 'report.pdf', '/generated/report.pdf',
        '{"id":"generated-1"}', '2026-10-01T10:03:00.000Z', 6);`);
}

function attachments(db: DatabaseSync) {
  return db.prepare("SELECT * FROM projection_attachments ORDER BY rowid").all();
}

function ownerIndexColumns(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM pragma_index_info('attachments_owner') ORDER BY seqno")
    .all()
    .map((column) => column.name);
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("attachment owner index migration", () => {
  // The table is the same from the v8 baseline on, so the oldest and the newest released schema bound it.
  it.each([8, 40])("upgrades v%i and keeps every attachment", (version) => {
    const db = databaseAt(version);
    seedAttachments(db);
    const before = attachments(db);
    migrateOpenBotDatabase(db);
    expect(attachments(db)).toEqual(before);
    expect(ownerIndexColumns(db)).toEqual(["owner_kind", "owner_id"]);
    expectHealthy(db);
  });

  it("rolls back the index and the marker after a failure, then retries", () => {
    const db = databaseAt(40);
    seedAttachments(db);
    const before = attachments(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 41
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 41 failed");
    expect(ownerIndexColumns(db)).toEqual([]);
    expect(attachments(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 41").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(attachments(db)).toEqual(before);
    expect(ownerIndexColumns(db)).toEqual(["owner_kind", "owner_id"]);
    expectHealthy(db);
  });

  it("rolls back when the index name is taken, then retries", () => {
    const db = databaseAt(40);
    seedAttachments(db);
    const before = attachments(db);
    // SQLite refuses an index whose name a table holds, even with IF NOT EXISTS.
    db.exec("CREATE TABLE attachments_owner (conflict TEXT)");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 41 failed");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 41").all()).toEqual([]);
    expect(attachments(db)).toEqual(before);
    db.exec("DROP TABLE attachments_owner");
    migrateOpenBotDatabase(db);
    expect(attachments(db)).toEqual(before);
    expect(ownerIndexColumns(db)).toEqual(["owner_kind", "owner_id"]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it adds the index", () => {
    const db = databaseAt(40);
    seedAttachments(db);
    const before = attachments(db);
    db.exec("INSERT INTO schema_migrations VALUES(48, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 48; DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(attachments(db)).toEqual(before);
    expect(ownerIndexColumns(db)).toEqual([]);
  });
});
