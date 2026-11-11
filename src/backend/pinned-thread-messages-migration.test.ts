// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table, also a record of a deleted message;
// a failed upgrade leaves the table or its marker; a newer or incomplete history is accepted; a pin
// can point to no thread, have an empty id, have no pinner or a half pinner, or be recorded twice; a
// deleted thread or a deleted message leaves its pin behind; a pin of a message that is not shown is
// listed; the list of many threads mixes in the pins of another thread. These fixtures cover each.
const databases: DatabaseSync[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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

/** A chat thread with a user message and an answer, the rows that migration 61 must keep. */
function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO projection_threads
    (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('thread-chief', 'chief', 'Chief 界"\\', NULL, '2026-01-01', '2026-01-01', 3)`).run();
  const insert = db.prepare(`INSERT INTO projection_thread_messages
    (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
    VALUES ('thread-chief', ?, NULL, ?, 'completed', NULL, ?, ?, ?, 3)`);
  insert.run(
    "message-1",
    "user",
    "2026-01-01T09:00:00.000Z",
    0,
    JSON.stringify({ id: "message-1", author: "user", text: "Pin this 界", createdAt: "2026-01-01T09:00:00.000Z" }),
  );
  insert.run(
    "message-2",
    "assistant",
    "2026-01-01T09:00:01.000Z",
    1,
    JSON.stringify({ id: "message-2", author: "agent", text: "Done.", createdAt: "2026-01-01T09:00:01.000Z" }),
  );
}

/** A record of a message that a person deleted. The table is there from version 55. */
function seedDeletedRecord(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO projection_deleted_thread_messages (thread_id, message_id, deleted_at)
     VALUES ('thread-chief', 'message-0 界', '2026-01-02T08:00:00.000Z')`,
  ).run();
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

const PIN_TABLES = { projection_pinned_thread_messages: [] };

function pinTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%pinned_thread_messages%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 61 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("pinned thread messages migration", () => {
  it.each(Array.from({ length: 53 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db);
      // The earlier migrations run first; the rows after them are what v61 must keep.
      if (version < 60) migrateUpTo(db, 60);
      seedDeletedRecord(db);
      const before = contents(db);
      expect(before.projection_thread_messages).toHaveLength(2);
      expect(before.projection_deleted_thread_messages).toHaveLength(1);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...PIN_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAt(60);
    seed(db);
    seedDeletedRecord(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=61
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 61 failed");
    expect(contents(db)).toEqual(before);
    expect(pinTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=61").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...PIN_TABLES });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAt(60);
    seed(db);
    seedDeletedRecord(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=62; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(pinTables(db)).toEqual([]);
  });

  it("refuses to open a version 61 database in an older application", () => {
    const db = databaseAt(60);
    seed(db);
    migrateOpenBotDatabase(db);
    db.prepare(
      `INSERT INTO projection_pinned_thread_messages (thread_id, message_id, pinned_at, pinned_by_kind)
       VALUES ('thread-chief', 'message-1', '2026-01-02', 'person')`,
    ).run();
    const after = contents(db);
    // The next release adds 62: this application is the older one for that database.
    db.exec("INSERT INTO schema_migrations VALUES(62,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("refuses a pin of no thread, an empty id, a bad pinner or a second pin, and the pin goes with its thread", () => {
    const db = databaseAt(60);
    seed(db);
    migrateOpenBotDatabase(db);
    const insert = db.prepare(`INSERT INTO projection_pinned_thread_messages
      (thread_id, message_id, pinned_at, pinned_by_kind, pinned_by_id, pinned_by_name)
      VALUES (?, ?, '2026-01-02', ?, ?, ?)`);
    expect(() => insert.run("thread-unknown", "message-1", "person", null, null)).toThrow(
      "FOREIGN KEY constraint failed",
    );
    expect(() => insert.run("thread-chief", "", "person", null, null)).toThrow("CHECK constraint failed");
    // A pinner is a person, with an id and a name or neither, or an agent with only an id.
    expect(() => insert.run("thread-chief", "message-1", null, null, null)).toThrow("NOT NULL constraint failed");
    expect(() => insert.run("thread-chief", "message-1", "bot", null, null)).toThrow("CHECK constraint failed");
    expect(() => insert.run("thread-chief", "message-1", "agent", null, null)).toThrow("CHECK constraint failed");
    expect(() => insert.run("thread-chief", "message-1", "agent", "chief", "Chief")).toThrow("CHECK constraint failed");
    expect(() => insert.run("thread-chief", "message-1", "agent", "", null)).toThrow("CHECK constraint failed");
    expect(() => insert.run("thread-chief", "message-1", "person", "member-1", null)).toThrow(
      "CHECK constraint failed",
    );
    expect(() => insert.run("thread-chief", "message-1", "person", null, "Ada")).toThrow("CHECK constraint failed");
    insert.run("thread-chief", "message-1", "person", "member-1", "Ada 界");
    insert.run("thread-chief", "message-2", "agent", "chief", null);
    expect(() => insert.run("thread-chief", "message-1", "person", null, null)).toThrow("UNIQUE constraint failed");
    expect(
      db
        .prepare(
          "SELECT thread_id, message_id, pinned_by_kind, pinned_by_id, pinned_by_name FROM projection_pinned_thread_messages ORDER BY message_id",
        )
        .all(),
    ).toEqual([
      {
        thread_id: "thread-chief",
        message_id: "message-1",
        pinned_by_kind: "person",
        pinned_by_id: "member-1",
        pinned_by_name: "Ada 界",
      },
      {
        thread_id: "thread-chief",
        message_id: "message-2",
        pinned_by_kind: "agent",
        pinned_by_id: "chief",
        pinned_by_name: null,
      },
    ]);
    db.prepare("DELETE FROM projection_threads WHERE thread_id='thread-chief'").run();
    expect(db.prepare("SELECT * FROM projection_pinned_thread_messages").all()).toEqual([]);
    expectHealthy(db);
  });
});

describe("pinned thread messages", () => {
  it("lists pins newest first over threads, keeps the pinner, hides a pin of no shown message, and a delete removes the pin", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-pins-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    try {
      const agent = testAgent();
      const threadId = "openbot-thread-chief";
      database.replaceAgents("seed-pins", [agent], "agents.updated");
      const messages = ["first", "second", "third"].map((id, index) => message(id, index));
      database.persistConversation(
        { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages },
        "conversation.saved",
      );
      // A side thread of the same agent. The thread store writes its row; this fixture writes it here.
      const sideThreadId = "openbot-thread-chief-side";
      database.connection
        .prepare(
          `INSERT INTO projection_threads
             (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
           VALUES (?, ?, 'Side', NULL, '2026-02-01', '2026-02-01', 0)`,
        )
        .run(sideThreadId, agent.id);
      database.persistConversation(
        { agentId: agent.id, threadId: sideThreadId, activeTurnId: null, revision: 0, messages: [message("side", 0)] },
        "conversation.saved",
      );
      const ids = (threadIds: readonly string[]) =>
        database.pinnedThreadMessages(threadIds, 200).map((pin) => pin.message.id);
      expect(database.pinnedThreadMessages([threadId], 200)).toEqual([]);
      expect(database.pinnedThreadMessages([], 200)).toEqual([]);
      expect(database.pinnedThreadMessageCount(threadId)).toBe(0);
      expect(database.threadMessagePinner(threadId, "first")).toBeNull();

      const you = { kind: "person", sender: null } as const;
      const member = { kind: "person", sender: { id: "member-1", name: "Ada 界" } } as const;
      const chief = { kind: "agent", agentId: agent.id } as const;
      database.pinThreadMessage(threadId, "second", "2026-02-01T10:00:00.000Z", you);
      database.pinThreadMessage(threadId, "first", "2026-02-01T10:00:02.000Z", member);
      database.pinThreadMessage(threadId, "third", "2026-02-01T10:00:01.000Z", chief);
      database.pinThreadMessage(sideThreadId, "side", "2026-02-01T10:00:03.000Z", chief);
      // A second pin keeps the first time and the first pinner.
      database.pinThreadMessage(threadId, "second", "2026-02-01T11:00:00.000Z", chief);
      // No row of `projection_thread_messages` has this id.
      database.pinThreadMessage(threadId, "not-shown", "2026-02-01T12:00:00.000Z", you);

      const listed = database.pinnedThreadMessages([threadId], 200);
      expect(listed.map((pin) => [pin.message.id, pin.pinnedAt, pin.pinnedBy])).toEqual([
        ["first", "2026-02-01T10:00:02.000Z", member],
        ["third", "2026-02-01T10:00:01.000Z", chief],
        ["second", "2026-02-01T10:00:00.000Z", you],
      ]);
      expect(listed[0]?.message.text).toBe("Message first 界");
      expect(listed.every((pin) => pin.threadId === threadId)).toBe(true);
      // The list of the agent covers its threads, newest pin first, and stops at the limit.
      expect(ids([threadId, sideThreadId])).toEqual(["side", "first", "third", "second"]);
      expect(database.pinnedThreadMessages([threadId, sideThreadId], 2).map((pin) => pin.threadId)).toEqual([
        sideThreadId,
        threadId,
      ]);
      expect(database.threadMessagePinner(threadId, "not-shown")).toEqual(you);
      expect(database.threadMessagePinner(threadId, "second")).toEqual(you);
      // The pin of a message that is not shown does not count toward the limit.
      expect(database.pinnedThreadMessageCount(threadId)).toBe(3);
      expect(database.pinnedThreadMessageCount(sideThreadId)).toBe(1);
      expect(ids(["openbot-thread-other"])).toEqual([]);

      database.unpinThreadMessage(threadId, "third");
      expect(database.threadMessagePinner(threadId, "third")).toBeNull();
      expect(ids([threadId])).toEqual(["first", "second"]);
      expect(database.pinnedThreadMessageCount(threadId)).toBe(2);

      // The delete of a shown message removes its pin with it.
      database.persistConversationChanges({
        agentId: agent.id,
        threadId,
        activeTurnId: null,
        changedMessages: [],
        deletedMessageIds: ["first"],
        eventType: "conversation.message-deleted",
        detail: { messageId: "first" },
      });
      expect(database.threadMessagePinner(threadId, "first")).toBeNull();
      expect(ids([threadId])).toEqual(["second"]);
      expect(database.pinnedThreadMessageCount(threadId)).toBe(1);
      expect(database.readConversation(agent.id, threadId).messages.map(({ id }) => id)).toEqual(["second", "third"]);

      // A replay writes every message row again: the pins stay, and the deleted message stays away.
      database.rebuildThreadProjection(threadId);
      expect(ids([threadId])).toEqual(["second"]);
      expect(database.threadMessagePinner(threadId, "second")).toEqual(you);

      // "Delete history" removes every pin of the thread.
      database.deleteThreadHistory({ agentId: agent.id, threadId });
      expect(ids([threadId])).toEqual([]);
      expect(database.pinnedThreadMessageCount(threadId)).toBe(0);
      expect(database.threadMessagePinner(threadId, "not-shown")).toBeNull();
      // The pins of another thread stay.
      expect(ids([threadId, sideThreadId])).toEqual(["side"]);
    } finally {
      database.close();
    }
  });
});

function message(id: string, index: number): ConversationMessage {
  return {
    id,
    author: index % 2 === 0 ? "user" : "agent",
    text: `Message ${id} 界`,
    status: "completed",
    createdAt: `2026-02-01T09:00:0${index}.000Z`,
  };
}

function testAgent(): AgentSummary {
  return {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "openbot-thread-chief",
    workspacePath: "/tmp/openbot-chief",
    preview: "42",
    updatedAt: "2026-08-18T10:00:01.000Z",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
}
