// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

describe("remote agent bridge migration", () => {
  it("keeps mailbox messages and starts with empty link tables", () => {
    const db = databaseAt(62);
    const rows = [
      [
        "user-1",
        "user",
        JSON.stringify({
          id: "user-1",
          sender: { kind: "user" },
          text: "Hello",
          attachments: [],
          replyToMessageId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      [
        "agent-1",
        "agent",
        JSON.stringify({
          id: "agent-1",
          sender: { kind: "agent", agentId: "ada" },
          text: "Reply",
          attachments: [],
          replyToMessageId: null,
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
      ],
      [
        "routine-1",
        "routine",
        JSON.stringify({
          id: "routine-1",
          sender: {
            kind: "routine",
            routineId: "r",
            runId: "run",
            routineName: "Morning",
            scheduledFor: "2026-01-01T08:00:00.000Z",
          },
          text: "Run",
          attachments: [],
          replyToMessageId: null,
          createdAt: "2026-01-01T00:00:02.000Z",
        }),
      ],
    ] as const;
    const insert = db.prepare(
      `INSERT INTO projection_mailbox_messages
       (message_id, sender_kind, sender_agent_id, text, reply_to_message_id, created_at, message_json, last_event_sequence)
       VALUES (?, ?, NULL, 'kept', NULL, '2026-01-01T00:00:00.000Z', ?, 1)`,
    );
    for (const [id, kind, json] of rows) insert.run(id, kind, json);
    const before = db
      .prepare("SELECT message_id, sender_kind, message_json FROM projection_mailbox_messages ORDER BY message_id")
      .all();

    migrateOpenBotDatabase(db);

    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 66 });
    expect(
      db
        .prepare("SELECT message_id, sender_kind, message_json FROM projection_mailbox_messages ORDER BY message_id")
        .all(),
    ).toEqual(before);
    expect(db.prepare("SELECT * FROM remote_agent_bridge_invites").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM remote_agent_bridge_links").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
