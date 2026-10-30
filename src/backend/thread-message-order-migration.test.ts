// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ORDER_KEY_COLUMNS, ORDER_KEY_DESC, ORDERED_THREAD_MESSAGES } from "./database/conversation-queries";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses or changes a message; a stored key differs from the order that pages
// computed before, so a page or a cursor that a client holds moves; a turn id that two threads share
// mixes their orders; a partial migration survives a failure; a retry adds a column twice or keeps a
// wrong key; a newer or incomplete history is changed.
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

const THREAD = "openbot-thread-agent-chief";
const OTHER_THREAD = "openbot-thread-agent-helper";

type Seed = [
  thread: string,
  id: string,
  turn: string | null,
  author: string,
  itemType: string | null,
  createdAt: string,
  ordinal: number,
  direction?: string,
];

const MESSAGES: readonly Seed[] = [
  // A turn with commentary and a steer: from the second input on, the turn goes by time.
  [THREAD, "ask", "turn-1", "user", null, "2026-10-01T10:00:00.000Z", 0],
  [THREAD, "thinking", "turn-1", "assistant", "commentary", "2026-10-01T10:00:01.000Z", 1],
  // Queued while the turn ran: it stays after the turn's answer (#1540).
  [THREAD, "queued", null, "user", null, "2026-10-01T10:00:01.500Z", 2],
  [THREAD, "steer", "turn-1", "user", null, "2026-10-01T10:00:02.000Z", 3],
  [THREAD, "answer", "turn-1", "assistant", null, "2026-10-01T10:00:03.000Z", 4],
  // A teammate's turn: an incoming exchange is input, then the plan, then the outgoing reply.
  [THREAD, "reply", "turn-2", "agent", null, "2026-10-01T10:01:00.000Z", 5, "outgoing"],
  [THREAD, "request", "turn-2", "agent", null, "2026-10-01T10:01:01.000Z", 6, "incoming"],
  [THREAD, "plan", "turn-2", "assistant", "plan", "2026-10-01T10:01:02.000Z", 7],
  // A blank turn id is no turn, and two messages at one time go by their ordinal.
  [THREAD, "notice", "", "system", "context_reset", "2026-10-01T10:02:00.000Z", 8],
  [THREAD, "same-time-b", null, "agent", null, "2026-10-01T10:03:00.000Z", 9],
  [THREAD, "same-time-a", null, "agent", null, "2026-10-01T10:03:00.000Z", 10],
  // Another thread with the same turn id, earlier: it must not move the first thread's turn.
  [OTHER_THREAD, "other-ask", "turn-1", "user", null, "2026-10-01T09:00:00.000Z", 0],
  [OTHER_THREAD, "other-answer", "turn-1", "assistant", null, "2026-10-01T09:00:01.000Z", 1],
];

const SHOWN_ORDER = [
  "ask",
  "thinking",
  "steer",
  "answer",
  "queued",
  "request",
  "plan",
  "reply",
  "notice",
  "same-time-b",
  "same-time-a",
];

function seedMessages(db: DatabaseSync): void {
  for (const [thread, agent] of [
    [THREAD, "agent-chief"],
    [OTHER_THREAD, "agent-helper"],
  ]) {
    db.prepare(
      `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, 'Chat', NULL, '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 1)`,
    ).run(thread ?? "", agent ?? "");
  }
  const insert = db.prepare(
    `INSERT INTO projection_thread_messages
       (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
     VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, 2)`,
  );
  for (const [thread, id, turn, author, itemType, createdAt, ordinal, direction] of MESSAGES) {
    const message = {
      id,
      author,
      status: "completed",
      text: id,
      createdAt,
      ...(turn ? { turnId: turn } : {}),
      ...(itemType ? { itemType } : {}),
      ...(direction ? { exchange: { direction, messageId: `exchange-${id}` } } : {}),
    };
    insert.run(thread, id, turn, author, itemType, createdAt, ordinal, JSON.stringify(message));
  }
}

/**
 * The window that pages ran over a thread before migration 40, frozen here as the reference that the
 * stored keys must equal.
 */
const RELEASED_ORDER = `WITH ranked AS (
  SELECT created_at, ordinal, message_id, author, item_type, NULLIF(turn_id, '') AS turn,
    CASE
      WHEN author = 'user' THEN 0
      WHEN author = 'assistant' THEN CASE WHEN item_type IN ('commentary', 'plan') THEN 1 ELSE 3 END
      WHEN json_extract(message_json, '$.exchange.direction') = 'incoming' THEN 0
      ELSE 2
    END AS role_rank
  FROM projection_thread_messages WHERE thread_id = ?
), ordered AS (
  SELECT created_at, ordinal, message_id, author, item_type,
    CASE WHEN turn IS NULL THEN created_at ELSE MIN(created_at) OVER turn_by_time END AS group_start,
    CASE WHEN turn IS NULL THEN ordinal
      ELSE FIRST_VALUE(ordinal) OVER turn_by_time END AS group_first,
    CASE WHEN turn IS NULL THEN 'message:' || message_id ELSE 'turn:' || turn END AS group_id,
    CASE WHEN turn IS NULL THEN 0
      WHEN SUM(role_rank = 0) OVER turn_by_time >= 2 THEN 4
      ELSE role_rank END AS turn_rank
  FROM ranked
  WINDOW turn_by_time AS (PARTITION BY turn ORDER BY created_at, ordinal)
)`;

type TableRow = Record<string, SQLOutputValue>;

const RELEASED_COLUMNS =
  "thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence";

function releasedRows(db: DatabaseSync): TableRow[] {
  return db.prepare(`SELECT ${RELEASED_COLUMNS} FROM projection_thread_messages ORDER BY rowid`).all();
}

function orderKeys(db: DatabaseSync, cte: string, threadId: string): TableRow[] {
  return db.prepare(`${cte} SELECT ${ORDER_KEY_COLUMNS} FROM ordered ORDER BY ${ORDER_KEY_COLUMNS}`).all(threadId);
}

function columnNames(db: DatabaseSync) {
  return db
    .prepare("PRAGMA table_info(projection_thread_messages)")
    .all()
    .map((column) => column.name);
}

function orderIndexes(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'projection_thread_messages'
       AND name IN ('thread_messages_shown_order', 'thread_messages_turn') ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("thread message order migration", () => {
  it.each(Array.from({ length: 32 }, (_, index) => index + 8))(
    "stores the released order of every message from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seedMessages(db);
      const before = releasedRows(db);
      const released = [THREAD, OTHER_THREAD].map((thread) => orderKeys(db, RELEASED_ORDER, thread));
      // A cursor that a client holds: the page before the queued message.
      const cursor = released[0]?.find((row) => row.message_id === "queued");
      if (!cursor) throw new Error("The fixture has no queued message.");
      const cursorKeys = ORDER_KEY_COLUMNS.split(", ").map((column) => cursor[column] ?? null);
      const pageBefore = `SELECT message_id FROM ordered WHERE (${ORDER_KEY_COLUMNS}) < (?, ?, ?, ?, ?, ?, ?)
        ORDER BY ${ORDER_KEY_DESC} LIMIT 3`;
      const releasedPage = db.prepare(`${RELEASED_ORDER} ${pageBefore}`).all(THREAD, ...cursorKeys);

      migrateOpenBotDatabase(db);

      expect(releasedRows(db)).toEqual(before);
      expect([THREAD, OTHER_THREAD].map((thread) => orderKeys(db, ORDERED_THREAD_MESSAGES, thread))).toEqual(released);
      expect(orderKeys(db, ORDERED_THREAD_MESSAGES, THREAD).map((row) => row.message_id)).toEqual(SHOWN_ORDER);
      expect(db.prepare(`${ORDERED_THREAD_MESSAGES} ${pageBefore}`).all(THREAD, ...cursorKeys)).toEqual(releasedPage);
      expect(orderIndexes(db)).toEqual(["thread_messages_shown_order", "thread_messages_turn"]);
      expectHealthy(db);
    },
  );

  it("rolls back the columns, the keys and the marker after a late failure, then retries", () => {
    const db = databaseAt(39);
    seedMessages(db);
    const before = releasedRows(db);
    const columns = columnNames(db);
    const released = orderKeys(db, RELEASED_ORDER, THREAD);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 40
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 40 failed");
    expect(columnNames(db)).toEqual(columns);
    expect(orderIndexes(db)).toEqual([]);
    expect(releasedRows(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 40").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(releasedRows(db)).toEqual(before);
    expect(orderKeys(db, ORDERED_THREAD_MESSAGES, THREAD)).toEqual(released);
    expectHealthy(db);
  });

  it("repairs the keys of a development build that added the columns before the marker", () => {
    const db = databaseAt(39);
    seedMessages(db);
    const released = orderKeys(db, RELEASED_ORDER, THREAD);
    db.exec(`ALTER TABLE projection_thread_messages ADD COLUMN group_start TEXT;
      ALTER TABLE projection_thread_messages ADD COLUMN group_first INTEGER;
      ALTER TABLE projection_thread_messages ADD COLUMN group_id TEXT;
      ALTER TABLE projection_thread_messages ADD COLUMN turn_rank INTEGER;
      UPDATE projection_thread_messages SET group_start = created_at, group_first = 0, group_id = 'stale', turn_rank = 9
        WHERE message_id IN ('ask', 'request');`);
    migrateOpenBotDatabase(db);
    expect(orderKeys(db, ORDERED_THREAD_MESSAGES, THREAD)).toEqual(released);
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it changes a message", () => {
    const db = databaseAt(39);
    seedMessages(db);
    const before = releasedRows(db);
    const columns = columnNames(db);
    db.exec("INSERT INTO schema_migrations VALUES(48, 'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version = 48; DELETE FROM schema_migrations WHERE version = 38");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 38");
    expect(releasedRows(db)).toEqual(before);
    expect(columnNames(db)).toEqual(columns);
  });
});
