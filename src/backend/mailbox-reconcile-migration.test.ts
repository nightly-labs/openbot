// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade deletes a reconcile event that is not a repeat, or the last event of a run,
// or an event of another type or thread; it leaves the activity or receipt of a deleted event; it changes
// a message row or what a replay rebuilds; a failed upgrade deletes events or leaves its marker; a newer or
// incomplete history is accepted. These fixtures cover each.
const databases: DatabaseSync[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const RECONCILED = "conversation.mailbox-reconciled";

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

/**
 * Two threads. In the chief's thread, a run of three equal reconcile events with an event of the other
 * thread between them, another event, the same payload once more, then a run of two of a second
 * payload. The other thread has two reconcile events with different payloads.
 */
function seed(db: DatabaseSync): void {
  const thread = db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, 1)");
  thread.run("openbot-thread-chief", "chief", 'Chief 界"\\', "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  thread.run("openbot-thread-other", "other", "Other", "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z");
  const first = JSON.stringify({ detail: { messageCount: 1 }, changedMessages: [{ id: "a", text: "界" }] });
  const second = JSON.stringify({ detail: { messageCount: 1 }, changedMessages: [{ id: "a", text: "b" }] });
  const events: Array<[string, string, string]> = [
    ["openbot-thread-chief", RECONCILED, first],
    ["openbot-thread-chief", RECONCILED, first],
    ["openbot-thread-other", RECONCILED, first],
    ["openbot-thread-chief", RECONCILED, first],
    ["openbot-thread-chief", "conversation.updated", first],
    ["openbot-thread-chief", RECONCILED, first],
    ["openbot-thread-other", RECONCILED, second],
    ["openbot-thread-chief", RECONCILED, second],
    ["openbot-thread-chief", RECONCILED, second],
  ];
  const event = db.prepare(`INSERT INTO orchestration_events
    (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
    VALUES (?, ?, 'thread', ?, ?, '2026-10-01T08:00:00.000Z', ?)`);
  const receipt = db.prepare(
    "INSERT INTO orchestration_command_receipts VALUES (?, '2026-10-01T08:00:00.000Z', ?, ?, '{}')",
  );
  const activity = db.prepare(
    "INSERT INTO projection_thread_activities VALUES (?, ?, NULL, ?, '{}', '2026-10-01T08:00:00.000Z', ?)",
  );
  events.forEach(([threadId, type, payload], index) => {
    const sequence = Number(event.run(`event-${index}`, `command-${index}`, threadId, type, payload).lastInsertRowid);
    receipt.run(`command-${index}`, sequence, sequence);
    activity.run(`activity-${index}`, threadId, type, sequence);
  });
}

type Rows = Record<string, ReturnType<StatementSync["all"]>>;

/**
 * Every row of every table, by table name. Migration 47 replaces the empty task table with the thread
 * table; `agent-thread-migration.test.ts` checks that move.
 */
function contents(db: DatabaseSync): Rows {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%'
       AND name NOT IN ('projection_agent_tasks', 'projection_agent_threads') ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

/** The rows that keep their event: every event but the first two and the eighth. */
function withoutRepeats(rows: Rows): Rows {
  const deleted = (table: string, column: string, prefix: string) =>
    (rows[table] ?? []).filter((row) => ![0, 1, 7].some((index) => row[column] === `${prefix}-${index}`));
  return {
    ...rows,
    orchestration_events: deleted("orchestration_events", "event_id", "event"),
    orchestration_command_receipts: deleted("orchestration_command_receipts", "command_id", "command"),
    projection_thread_activities: deleted("projection_thread_activities", "activity_id", "activity"),
    // Migrations 44 and 45 add them, empty.
    projection_messaging_allowed_roles: [],
    browser_profiles: [],
    // Migration 46 adds them, empty.
    workflow_edges: [],
    workflow_nodes: [],
    workflow_output_deliveries: [],
    workflow_runs: [],
    workflow_steps: [],
    workflow_trigger_webhooks: [],
    workflow_triggers: [],
    workflow_versions: [],
    workflow_webhook_receipts: [],
    workflows: [],
  };
}

describe("mailbox reconcile cleanup migration", () => {
  it.each(Array.from({ length: 31 }, (_, index) => index + 8))(
    "deletes only repeated reconcile events from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db);
      // The earlier migrations run first; the rows after them are what v39 must keep.
      if (version < 38) migrateUpTo(db, 38);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual(withoutRepeats(before));
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 48 });
      expect(db.prepare("SELECT name FROM sqlite_temp_master").all()).toEqual([]);
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the deletes and the marker after a late failure, then retries", () => {
    const db = databaseAt(38);
    seed(db);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=39
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 39 failed");
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=39").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(withoutRepeats(before));
  });

  it("rejects newer and incomplete migration histories before it deletes events", () => {
    const db = databaseAt(38);
    seed(db);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(49,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=49; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
  });

  it("keeps the messages and what a replay rebuilds from the writes of a page read", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-db-mailbox-reconcile-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const agent = testAgent();
    database.replaceAgents("mailbox-reconcile-agents", [agent], "agents.imported");
    const write = (eventType: string, messages: ConversationMessage[]) =>
      database.persistConversationChanges({
        agentId: agent.id,
        threadId: "openbot-thread-chief",
        activeTurnId: null,
        changedMessages: messages,
        eventType,
        detail: { messageCount: messages.length },
      });
    const question = message("question", "user", "Where is the report?");
    write("conversation.updated", [question, message("answer", "assistant", "Draft")]);
    // What a read wrote before #2224 was fixed: the same page again and again.
    for (let index = 0; index < 3; index++) write(RECONCILED, [question]);
    write("conversation.updated", [message("answer", "assistant", "Final")]);
    write(RECONCILED, [question]);
    const replayed = database.rebuildThreadProjection("openbot-thread-chief");
    const rows = database.connection.prepare("SELECT * FROM projection_thread_messages ORDER BY ordinal").all();
    const events = database.connection
      .prepare(
        "SELECT sequence, event_type FROM orchestration_events WHERE aggregate_type = 'thread' ORDER BY sequence",
      )
      .all();
    const path = database.path;
    database.close();

    const legacy = new DatabaseSync(path);
    // From 38 on: migration 47 reads the task table that 38 creates.
    legacy.exec("DELETE FROM schema_migrations WHERE version IN (38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48)");
    legacy.close();
    const migrated = new OpenBotDatabase(root);
    await runCauseEffect(migrated.initialize());
    expect(migrated.connection.prepare("SELECT * FROM projection_thread_messages ORDER BY ordinal").all()).toEqual(
      rows,
    );
    const kept = migrated.connection
      .prepare(
        "SELECT sequence, event_type FROM orchestration_events WHERE aggregate_type = 'thread' ORDER BY sequence",
      )
      .all();
    const reconciled = events.filter((event) => event.event_type === RECONCILED);
    expect(kept).toEqual(events.filter((event) => !reconciled.slice(0, 2).includes(event)));
    expect(migrated.rebuildThreadProjection("openbot-thread-chief")).toEqual(replayed);
    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 48,
    });
    migrated.close();
  });
});

function message(id: string, author: ConversationMessage["author"], text: string): ConversationMessage {
  return { id, author, text, createdAt: "2026-10-01T08:00:00.000Z", status: "completed" };
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
