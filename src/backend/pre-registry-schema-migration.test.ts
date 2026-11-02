// @vitest-environment node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: a database that v0.1.12 to v0.2.1 made loses a row on its first upgrade to the migration
// registry; the upgrade leaves a schema that a new install does not have; a foreign key or a page is broken.
// The other tests start from a schema that this code makes. These start from the DDL that each release shipped.
const appliedAt = "2026-10-17T12:00:00.000Z";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

interface ReleasedSchema {
  readonly tag: "v0.1.12" | "v0.1.15" | "v0.1.18" | "v0.2.1";
  readonly markers: readonly number[];
}

// A new install of a release wrote only its own version. An upgrade from an earlier release kept the
// earlier marker as well.
const RELEASED_SCHEMAS: readonly ReleasedSchema[] = [
  { tag: "v0.1.12", markers: [3] },
  { tag: "v0.1.15", markers: [4] },
  { tag: "v0.1.15", markers: [3, 4] },
  // v0.1.18 to v0.2.0 kept version 4 and added the message page index.
  { tag: "v0.1.18", markers: [4] },
  { tag: "v0.1.18", markers: [3, 4] },
  { tag: "v0.2.1", markers: [6] },
  { tag: "v0.2.1", markers: [3, 4, 6] },
];

function releasedDatabase({ tag, markers }: ReleasedSchema): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL(`./released-schemas/${tag}.sql`, import.meta.url), "utf8"));
  const insert = db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");
  for (const version of markers) insert.run(version, "2026-01-01T00:00:00.000Z");
  return db;
}

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateOpenBotDatabase(db, { appliedAt });
  return db;
}

const snapshot = { messages: [{ id: "message-1" }, { id: "message-2" }] };

// One or more rows in each table that these releases wrote. Thread `scout` has no read baseline, and the user
// has no read of the direct thread, so the baseline step has rows to add.
function seedSharedTables(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO orchestration_events
      (sequence, event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
    VALUES
      (1, 'event-1', 'command-1', 'thread', 'openbot-thread-chief', 'thread.snapshot', '2026-01-02T10:00:00.000Z',
        '{"snapshot":{"messages":[{"id":"message-1"}]}}'),
      (2, 'event-2', 'command-2', 'thread', 'openbot-thread-chief', 'thread.snapshot', '2026-01-02T10:01:00.000Z',
        '${JSON.stringify({ snapshot })}'),
      (3, 'event-3', 'command-3', 'thread', 'openbot-thread-chief', 'thread.renamed', '2026-01-02T10:02:00.000Z',
        '{"title":"Plans"}'),
      (4, 'event-4', 'command-4', 'mailbox', 'mailbox', 'mailbox.snapshot', '2026-01-02T10:03:00.000Z',
        '{"messages":[]}'),
      (5, 'event-5', 'command-5', 'mailbox', 'mailbox', 'mailbox.snapshot', '2026-01-02T10:04:00.000Z',
        '{"messages":[{"id":"mailbox-1"}]}');
    INSERT INTO orchestration_command_receipts (command_id, accepted_at, first_sequence, last_sequence, result_json)
    VALUES
      ('command-1', '2026-01-02T10:00:00.000Z', 1, 1, '{"revision":1}'),
      ('command-2', '2026-01-02T10:01:00.000Z', 2, 2, '{"ok":true}'),
      ('command-3', '2026-01-02T10:02:00.000Z', 3, 3, '{"ok":true}'),
      ('command-4', '2026-01-02T10:03:00.000Z', 4, 4, '{"ok":true}'),
      ('command-5', '2026-01-02T10:04:00.000Z', 5, 5, '{"ok":true}');
    INSERT INTO projection_threads
      (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
    VALUES
      ('openbot-thread-chief', 'chief', 'Plans', NULL, '2026-01-02T09:00:00.000Z', '2026-01-02T10:02:00.000Z', 3),
      ('openbot-thread-scout', 'scout', 'Scout', NULL, '2026-01-02T09:00:00.000Z', '2026-01-02T09:30:00.000Z', 2);
    INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence)
    VALUES
      ('chief', 'openbot-thread-chief', 'gpt-5', '2026-01-02T09:00:00.000Z', 0,
        '{"id":"chief","name":"Chief","workspacePath":"/Users/user/OpenBot/Bots/chief"}', 1),
      ('scout', 'openbot-thread-scout', 'claude-opus', NULL, 1, '{"id":"scout","name":"Scout"}', 2);
    INSERT INTO projection_provider_sessions (id, thread_id, provider, external_session_id, model, effort, state,
      created_at, updated_at, resume_cursor, last_event_sequence)
    VALUES
      ('session-1', 'openbot-thread-chief', 'codex', 'codex-thread-1', 'gpt-5', 'high', 'active',
        '2026-01-02T09:00:00.000Z', '2026-01-02T10:00:00.000Z', 'cursor-1', 2),
      ('session-2', 'openbot-thread-scout', 'claude', 'claude-session-2', 'claude-opus', 'medium', 'inactive',
        '2026-01-02T09:00:00.000Z', '2026-01-02T09:30:00.000Z', NULL, 2);
    INSERT INTO projection_turns
      (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
    VALUES
      ('turn-1', 'openbot-thread-chief', 'session-1', 'completed', '2026-01-02T10:00:00.000Z',
        '2026-01-02T10:01:00.000Z', 2),
      ('turn-2', 'openbot-thread-scout', 'session-2', 'completed', '2026-01-02T09:10:00.000Z', NULL, 2);
    INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
      ordinal, message_json, last_event_sequence)
    VALUES
      ('openbot-thread-chief', 'message-1', NULL, 'user', 'completed', NULL, '2026-01-02T10:00:00.000Z', 0,
        '{"id":"message-1","text":"Plan the week."}', 1),
      ('openbot-thread-chief', 'message-2', 'turn-1', 'agent', 'completed', 'agentMessage',
        '2026-01-02T10:00:30.000Z', 1, '{"id":"message-2","text":"Here is the plan."}', 2),
      ('openbot-thread-scout', 'scout-1', 'turn-2', 'agent', 'completed', 'agentMessage', '2026-01-02T09:20:00.000Z',
        0, '{"id":"scout-1","text":"Found it."}', 2);
    INSERT INTO projection_thread_reads (thread_id, member_id, through_message_id, updated_at)
    VALUES ('openbot-thread-chief', 'user', 'message-1', '2026-01-02T10:00:10.000Z');
    INSERT INTO projection_thread_read_baselines (thread_id, through_message_id, initialized_at)
    VALUES ('openbot-thread-chief', 'message-1', '2026-01-02T10:00:05.000Z');
    INSERT INTO projection_thread_activities
      (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
    VALUES
      ('activity-1', 'openbot-thread-chief', 'turn-1', 'thread.snapshot', '{"step":1}', '2026-01-02T10:00:00.000Z', 1),
      ('activity-3', 'openbot-thread-chief', NULL, 'thread.renamed', '{"title":"Plans"}', '2026-01-02T10:02:00.000Z', 3);
    INSERT INTO projection_mailbox_messages (message_id, sender_kind, sender_agent_id, text, reply_to_message_id,
      created_at, message_json, last_event_sequence)
    VALUES ('mailbox-1', 'agent', 'chief', 'Done.', NULL, '2026-01-02T10:04:00.000Z', '{"id":"mailbox-1"}', 5);
    INSERT INTO projection_deliveries (delivery_id, message_id, recipient_agent_id, status, turn_id, error,
      created_at, delivery_json, last_event_sequence)
    VALUES ('delivery-1', 'mailbox-1', 'scout', 'delivered', 'turn-2', NULL, '2026-01-02T10:04:00.000Z',
      '{"id":"delivery-1"}', 5);
    INSERT INTO projection_queue_state (agent_id, paused, metadata_json, last_event_sequence)
    VALUES ('chief', 1, '{"reason":"user"}', 5);
    INSERT INTO projection_reactions (agent_id, message_id, emoji, updated_at, last_event_sequence)
    VALUES ('chief', 'mailbox-1', '👍', '2026-01-02T10:05:00.000Z', 5);
    INSERT INTO projection_attachments
      (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
    VALUES ('openbot-thread-chief:message-1:file-1', 'thread-message', 'openbot-thread-chief:message-1', 'notes.md',
      '/Users/user/OpenBot/Attachments/notes.md', '{"id":"file-1"}', '2026-01-02T10:00:00.000Z', 1);
    INSERT INTO projection_thread_summaries
      (summary_id, thread_id, through_message_id, summary_text, estimated_tokens, created_at, last_event_sequence)
    VALUES ('summary-1', 'openbot-thread-chief', 'message-1', 'The user asked for a plan.', 12,
      '2026-01-02T10:01:00.000Z', 2);
    INSERT INTO projection_direct_threads
      (thread_id, member_a_id, member_b_id, created_at, updated_at, last_message_id, last_event_sequence)
    VALUES ('direct-1', 'chief', 'user', '2026-01-02T09:00:00.000Z', '2026-01-02T09:05:00.000Z', 'direct-message-1', 4);
    INSERT INTO projection_direct_messages (message_id, thread_id, sender_member_id, recipient_member_id, text,
      created_at, message_json, last_event_sequence)
    VALUES ('direct-message-1', 'direct-1', 'chief', 'user', 'Ready.', '2026-01-02T09:05:00.000Z',
      '{"id":"direct-message-1"}', 4);
    INSERT INTO projection_direct_reads (thread_id, member_id, last_read_sequence, updated_at)
    VALUES ('direct-1', 'chief', 4, '2026-01-02T09:05:00.000Z');
    INSERT INTO file_deletion_outbox (id, path, reason, created_at, attempts, last_error)
    VALUES ('outbox-1', '/Users/user/OpenBot/Attachments/old.md', 'attachment-deleted', '2026-01-02T09:00:00.000Z', 2,
      'EBUSY');
  `);
}

// The tables that v0.2.1 added.
function seedVersion6Tables(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO projection_agent_memories (memory_id, agent_id, text, normalized_text, origin, source_turn_id,
      created_at, updated_at, last_event_sequence)
    VALUES
      ('memory-1', 'chief', 'The user works in Kraków.', 'the user works in kraków.', 'automatic', 'turn-1',
        '2026-01-02T10:01:00.000Z', '2026-01-02T10:01:00.000Z', 2),
      ('memory-2', 'chief', 'Weekly plans go out on Monday.', 'weekly plans go out on monday.', 'manual', NULL,
        '2026-01-02T10:02:00.000Z', '2026-01-02T10:02:00.000Z', 3);
    INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
      updated_at, last_event_sequence)
    VALUES ('routine-1', 'chief', 'Weekly plan', 'Write the weekly plan.', 1, 'Europe/Warsaw',
      '2026-01-02T10:00:00.000Z', '2026-01-02T10:00:00.000Z', 3);
    INSERT INTO projection_routine_triggers (trigger_id, routine_id, schedule_json, next_run_at, created_at,
      updated_at, last_event_sequence)
    VALUES ('trigger-1', 'routine-1', '{"kind":"weekly","weekday":1,"time":"09:00"}', '2026-01-05T08:00:00.000Z',
      '2026-01-02T10:00:00.000Z', '2026-01-02T10:00:00.000Z', 3);
    INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
      routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
    VALUES
      ('run-1', 'routine-1', 'chief', 'trigger-1', 'scheduled', '2025-12-29T08:00:00.000Z', 'Weekly plan',
        'Write the weekly plan.', 'delivery-1', 'succeeded', NULL, '2025-12-29T08:00:00.000Z',
        '2025-12-29T08:05:00.000Z', 3),
      ('run-2', 'routine-1', 'chief', NULL, 'manual', '2026-01-02T10:00:00.000Z', 'Weekly plan',
        'Write the weekly plan.', NULL, 'failed', 'The provider stopped.', '2026-01-02T10:00:00.000Z',
        '2026-01-02T10:00:30.000Z', 3);
  `);
}

function userTables(db: DatabaseSync): string[] {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
       ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return db
    .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
    .all(table)
    .map((row) => String(row.name));
}

// The released columns of each table, in a stable order. A rebuild can change the rowid, so rows are sorted.
function releasedRows(db: DatabaseSync, tables: Readonly<Record<string, readonly string[]>>) {
  return Object.fromEntries(
    Object.entries(tables).map(([table, columns]) => {
      const rows = db
        .prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM ${table}`)
        .all()
        .map((row) => ({ ...row }));
      return [table, rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))];
    }),
  );
}

function schemaShape(db: DatabaseSync) {
  const objects = db
    .prepare(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    )
    .all()
    .map((row) => ({ ...row }));
  const columns = Object.fromEntries(
    userTables(db).map((table) => [
      table,
      db
        .prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid')
        .all(table)
        .map((row) => ({ ...row })),
    ]),
  );
  return { objects, columns };
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 49 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

// The rows that the baseline step changes on purpose. Every other released row must stay the same.
const CHANGED_TABLES = new Set([
  "orchestration_events",
  "orchestration_command_receipts",
  "projection_thread_activities",
  "projection_provider_sessions",
  "projection_thread_read_baselines",
  "projection_direct_reads",
]);

describe("upgrade from a released schema before the migration registry", () => {
  it.each(RELEASED_SCHEMAS)("upgrades $tag with markers $markers and keeps the user data", (released) => {
    const db = releasedDatabase(released);
    seedSharedTables(db);
    if (released.tag === "v0.2.1") seedVersion6Tables(db);
    const releasedColumns = Object.fromEntries(userTables(db).map((table) => [table, columnNames(db, table)]));
    const kept = Object.fromEntries(Object.entries(releasedColumns).filter(([table]) => !CHANGED_TABLES.has(table)));
    const before = releasedRows(db, kept);

    migrateOpenBotDatabase(db, { appliedAt });

    expect(releasedRows(db, kept)).toEqual(before);
    expectHealthy(db);
    expect(schemaShape(db)).toEqual(schemaShape(freshDatabase()));
    expect(
      db
        .prepare("SELECT version FROM schema_migrations WHERE version < 8 ORDER BY version")
        .all()
        .map((row) => row.version),
    ).toEqual(released.markers);

    // Compaction keeps the latest snapshot of each thread and of the mailbox, and every other event.
    expect(db.prepare("SELECT sequence FROM orchestration_events ORDER BY sequence").all()).toEqual([
      { sequence: 2 },
      { sequence: 3 },
      { sequence: 5 },
    ]);
    const latest = db.prepare("SELECT payload_json FROM orchestration_events WHERE sequence = 2").get();
    expect(JSON.parse(String(latest?.payload_json))).toEqual({
      snapshot,
      recovery: { turnProviderSessionIds: { "turn-1": "session-1" } },
    });
    expect(
      db.prepare("SELECT command_id, result_json FROM orchestration_command_receipts ORDER BY command_id").all(),
    ).toEqual([
      { command_id: "command-2", result_json: '{"revision":2}' },
      { command_id: "command-3", result_json: '{"ok":true}' },
      { command_id: "command-5", result_json: '{"ok":true}' },
    ]);
    expect(db.prepare("SELECT activity_id FROM projection_thread_activities").all()).toEqual([
      { activity_id: "activity-3" },
    ]);

    // Migrations 9, 10, 11 and 14 stop the open sessions. The turn keeps its session.
    expect(
      db.prepare("SELECT id, provider, state, updated_at FROM projection_provider_sessions ORDER BY id").all(),
    ).toEqual([
      { id: "session-1", provider: "codex", state: "inactive", updated_at: appliedAt },
      { id: "session-2", provider: "claude", state: "inactive", updated_at: "2026-01-02T09:30:00.000Z" },
    ]);
    expect(db.prepare("SELECT turn_id, provider_session_id FROM projection_turns ORDER BY turn_id").all()).toEqual([
      { turn_id: "turn-1", provider_session_id: "session-1" },
      { turn_id: "turn-2", provider_session_id: "session-2" },
    ]);

    // A thread with no baseline gets its newest message; a direct thread member with no read gets one.
    expect(db.prepare("SELECT * FROM projection_thread_read_baselines ORDER BY thread_id").all()).toEqual([
      {
        thread_id: "openbot-thread-chief",
        through_message_id: "message-1",
        initialized_at: "2026-01-02T10:00:05.000Z",
      },
      { thread_id: "openbot-thread-scout", through_message_id: "scout-1", initialized_at: appliedAt },
    ]);
    expect(db.prepare("SELECT * FROM projection_direct_reads ORDER BY member_id").all()).toEqual([
      { thread_id: "direct-1", member_id: "chief", last_read_sequence: 4, updated_at: "2026-01-02T09:05:00.000Z" },
      { thread_id: "direct-1", member_id: "user", last_read_sequence: 4, updated_at: appliedAt },
    ]);

    // A released reaction is the user's.
    expect(db.prepare("SELECT actor_kind, actor_agent_id FROM projection_reactions").all()).toEqual([
      { actor_kind: "user", actor_agent_id: "" },
    ]);
    // No id is generated, so migration 13 changes no path.
    expect(db.prepare("SELECT agent_json FROM projection_agents WHERE agent_id = 'chief'").get()).toEqual({
      agent_json: '{"id":"chief","name":"Chief","workspacePath":"/Users/user/OpenBot/Bots/chief"}',
    });

    if (released.tag !== "v0.2.1") return;
    // Migration 32 indexes the released memories and selects them for the context.
    expect(
      db
        .prepare("SELECT rowid FROM agent_memory_search WHERE agent_memory_search MATCH 'Kraków'")
        .all()
        .map((row) => row.rowid),
    ).toEqual(
      db
        .prepare("SELECT rowid FROM projection_agent_memories WHERE memory_id = 'memory-1'")
        .all()
        .map((row) => row.rowid),
    );
    expect(db.prepare("SELECT memory_id, inclusion FROM agent_memory_selections ORDER BY memory_id").all()).toEqual([
      { memory_id: "memory-1", inclusion: "essential" },
      { memory_id: "memory-2", inclusion: "essential" },
    ]);
  });

  it("rolls back the baseline and keeps the released data when it fails, then retries", () => {
    const released = { tag: "v0.2.1", markers: [3, 4, 6] } as const;
    const db = releasedDatabase(released);
    seedSharedTables(db);
    seedVersion6Tables(db);
    const tables = Object.fromEntries(userTables(db).map((table) => [table, columnNames(db, table)]));
    const before = releasedRows(db, tables);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 8
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);

    expect(() => migrateOpenBotDatabase(db, { appliedAt })).toThrow("migration to version 8 failed");
    expect(userTables(db)).toEqual(Object.keys(tables).sort());
    expect(releasedRows(db, tables)).toEqual(before);
    expect(columnNames(db, "projection_reactions")).toEqual(tables.projection_reactions);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 3 },
      { version: 4 },
      { version: 6 },
    ]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db, { appliedAt });
    expectHealthy(db);
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_thread_messages").get()).toEqual({ count: 3 });
  });
});
