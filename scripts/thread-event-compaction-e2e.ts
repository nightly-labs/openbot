import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { AgentStore } from "../src/backend/agent-store";
import { databaseRows } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/thread-event-compaction-e2e");
const UPDATED = "conversation.snapshot-updated";
const RECONCILED = "conversation.mailbox-reconciled";
const BASE = Date.parse("2026-05-06T12:00:00.000Z");

interface CaseReport {
  name: string;
  events: number;
  compactedEvents: number;
  rewritten: number;
  minimumRewritten: number;
  deleted: number;
  minimumDeleted: number;
  laterPassDeleted: number;
  bytesBefore: number;
  bytesAfter: number;
  replayMatches: boolean;
  rowsMatch: boolean;
  otherKeysKept: boolean;
  secondPassRewritten: number;
  thirdPassRewritten: number;
  passed: boolean;
  difference?: string;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

function message(id: string, minute: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id,
    author: "agent",
    text: `Message ${id}`,
    createdAt: new Date(BASE + minute * 60_000).toISOString(),
    status: "completed",
    reactions: [],
    reaction: null,
    ...extra,
  };
}

function queued(id: string, minute: number, position: number): ConversationMessage {
  return message(id, minute, { author: "user", delivery: { id, status: "queued", position } });
}

interface OldUpdate {
  removed?: string[];
  activeTurnId?: string | null;
  eventType?: string;
  detail?: DynamicRecord;
}

interface Context {
  raw(eventType: string, payload: DynamicRecord): void;
  update(messages: ConversationMessage[], input?: OldUpdate): void;
  write(changedMessages: ConversationMessage[], activeTurnId?: string | null): void;
  remove(messageIds: string[], activeTurnId?: string | null): void;
  compactBatch(): void;
  compactAll(): void;
  ageCompaction(): void;
}

interface Case {
  name: string;
  minimumRewritten: number;
  minimumDeleted?: number;
  oldEventsLater?: true;
  run(context: Context): void;
}

function thread(count: number, edited = -1, editText = "Edited"): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) =>
    message(`m${index}`, index, index === edited ? { text: editText } : {}),
  );
}

const cases: Case[] = [
  {
    name: "whole-thread updates",
    minimumRewritten: 38,
    run: ({ update }) => {
      for (let count = 1; count <= 40; count++)
        update(thread(count, count % 3 === 0 ? count - 2 : -1), { activeTurnId: null });
    },
  },
  {
    name: "no state before the first event, repeated ids",
    minimumRewritten: 1,
    run: ({ update }) => {
      update([message("a", 1), message("a", 1, { text: "Second copy" }), message("b", 2)]);
      update([message("a", 1, { text: "Second copy" }), message("a", 1), message("b", 2)]);
      update([message("a", 1), message("b", 2)]);
    },
  },
  {
    name: "removals, and a removed message that comes back",
    minimumRewritten: 3,
    run: ({ update }) => {
      update(thread(4));
      update(
        thread(4).filter((entry) => entry.id !== "m1"),
        { removed: ["m1"] },
      );
      update([...thread(4).filter((entry) => entry.id !== "m2"), message("m2", 2)], { removed: ["m2"] });
      update(thread(4));
      update([...thread(4), message("m4", 4)]);
    },
  },
  {
    name: "queued deliveries with a moving time",
    minimumRewritten: 10,
    run: ({ update }) => {
      for (let index = 0; index < 30; index++) {
        const moved = Math.floor(index / 3);
        update(
          [
            message("answer", 0),
            queued("q1", 1 + moved, 1),
            queued("q2", 2, 2 + (index % 2)),
            message("late", 5, moved > 5 ? {} : { text: "Old text" }),
          ],
          { eventType: index % 4 === 0 ? RECONCILED : UPDATED },
        );
      }
    },
  },
  {
    name: "active turn changes, with and without the key",
    minimumRewritten: 6,
    run: ({ update }) => {
      update(thread(3), { activeTurnId: null });
      update(thread(3), { activeTurnId: "turn-1", detail: { turnId: "turn-1" } });
      update(thread(3), { activeTurnId: "turn-1" });
      update(thread(3));
      update([...thread(3), message("m3", 3, { turnId: "turn-1" })], { activeTurnId: "turn-1" });
      update([...thread(3), message("m3", 3, { turnId: "turn-1" })], {
        activeTurnId: null,
        eventType: "turn.completed",
      });
      update([...thread(3), message("m3", 3, { turnId: "turn-1" })], { activeTurnId: null });
    },
  },
  {
    name: "deletes before and during compaction",
    minimumRewritten: 5,
    oldEventsLater: true,
    run: ({ update, remove, compactBatch }) => {
      for (let count = 1; count <= 6; count++) update(thread(count), { activeTurnId: null });
      remove(["m2"]);
      for (let count = 0; count < 4; count++) update(thread(6, 4, `Edit ${count}`), { activeTurnId: null });
      compactBatch();
      remove(["m4"]);
      update(thread(6), { activeTurnId: null });
    },
  },
  {
    name: "a whole snapshot between updates",
    minimumRewritten: 4,
    run: ({ update, raw }) => {
      for (let count = 1; count <= 4; count++) update(thread(count));
      raw(UPDATED, {
        detail: {},
        snapshot: { agentId: "", threadId: "", activeTurnId: null, revision: 0, messages: thread(2, 0, "Snapshot") },
        recovery: {},
      });
      update(thread(2, 0, "Snapshot"));
      update(thread(4));
      update(thread(4));
    },
  },
  {
    name: "streamed flushes, appended and imported messages",
    minimumRewritten: 4,
    run: ({ update, raw }) => {
      update(thread(2), { activeTurnId: "turn-1" });
      raw("response.delta-flushed", {
        detail: {},
        streamedMessage: message("s", 3, { text: "Hal", status: "streaming", turnId: "turn-1" }),
        activeTurnId: "turn-1",
      });
      update([...thread(2), message("s", 3, { text: "Hal", status: "streaming", turnId: "turn-1" })], {
        activeTurnId: "turn-1",
      });
      raw("response.delta-flushed", {
        detail: {},
        streamedMessage: message("s", 3, { text: "Half done", status: "streaming", turnId: "turn-1" }),
        activeTurnId: "turn-1",
      });
      update([...thread(2), message("s", 3, { text: "Hal", status: "streaming", turnId: "turn-1" })], {
        activeTurnId: "turn-1",
      });
      raw("message.appended", { detail: {}, appendedMessage: message("u", 4, { author: "user" }), activeTurnId: null });
      update(
        [
          ...thread(2),
          message("s", 3, { text: "Hal", status: "streaming", turnId: "turn-1" }),
          message("u", 4, { author: "user" }),
        ],
        {
          activeTurnId: null,
        },
      );
      raw("message.imported", { detail: {}, importedMessage: message("m0", 0, { text: "Imported" }) });
      update([
        message("m0", 0, { text: "Imported" }),
        message("m1", 1),
        message("s", 3, { text: "Hal", status: "streaming", turnId: "turn-1" }),
        message("u", 4, { author: "user" }),
      ]);
    },
  },
  {
    name: "key order and keys with no value",
    minimumRewritten: 2,
    run: ({ update }) => {
      update([message("a", 1, { senderAgentId: "agent-b" }), message("b", 2)]);
      update([message("a", 1), message("b", 2)]);
      const { text, ...rest } = message("b", 2);
      update([message("a", 1), { text, ...rest }]);
      update([message("a", 1), message("b", 2, { itemType: "agentMessage" })]);
      update([message("a", 1), message("b", 2, { itemType: "agentMessage" })]);
    },
  },
  {
    name: "writes between batches",
    minimumRewritten: 250,
    oldEventsLater: true,
    run: ({ update, write, remove, compactBatch }) => {
      for (let count = 1; count <= 300; count++) update(thread(Math.min(count, 25), count % 7), { activeTurnId: null });
      compactBatch();
      write(thread(25, 3, "Live edit"));
      write([...thread(25, 3, "Live edit"), message("m25", 25)]);
      for (let count = 0; count < 300; count++) update(thread(26), { activeTurnId: null });
      compactBatch();
      remove(["m10"]);
      compactBatch();
      update(thread(26), { activeTurnId: null });
    },
  },
  {
    name: "single-message updates that a later update replaces",
    minimumRewritten: 1,
    minimumDeleted: 47,
    run: ({ write }) => {
      const streaming = (id: string, minute: number, text: string, extra: Partial<ConversationMessage> = {}) =>
        message(id, minute, { text, status: "streaming", ...extra });
      write([streaming("x", 1, "x0"), streaming("y", 2, "y0")]);
      for (let step = 1; step <= 25; step++) {
        write([streaming("x", 1, `x${step}`, step === 25 ? { itemType: "agentMessage" } : {})]);
        write([streaming("y", 2, `y${step}`, step === 10 ? { turnId: "turn-1" } : {})]);
      }
      write([streaming("x", 1, "x25", { itemType: "agentMessage" })]);
      write([message("x", 1, { text: "x done" })]);
      write([message("y", 2, { text: "y done" })]);
      write([message("z", 3)]);
    },
  },
  {
    name: "a compacted thread with many new events is taken again",
    minimumRewritten: 0,
    minimumDeleted: 1000,
    run: ({ write, compactAll, ageCompaction }) => {
      write([message("a", 1, { text: "a0" }), message("b", 2, { text: "b0" })]);
      compactAll();
      ageCompaction();
      for (let step = 1; step <= 520; step++) {
        write([message("a", 1, { text: `a${step}` })]);
        write([message("b", 2, { text: `b${step}` })]);
      }
    },
  },
];

interface Side {
  database: OpenBotDatabase;
  agentId: string;
  threadId: string;
  totals: { rewritten: number; deleted: number; bytesBefore: number; bytesAfter: number };
}

async function openSide(root: string): Promise<Side> {
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Writer", description: "Gets old events", avatarSeed: "compaction", avatarHue: null }),
  );
  const threadId = store.ensureThreadIdNow(agent.id);
  database.persistConversationChanges({
    agentId: agent.id,
    threadId,
    activeTurnId: null,
    changedMessages: [],
    eventType: UPDATED,
  });
  database.connection.prepare("DELETE FROM orchestration_events WHERE aggregate_id = ?").run(threadId);
  database.connection.prepare("DELETE FROM projection_thread_activities WHERE thread_id = ?").run(threadId);
  return { database, agentId: agent.id, threadId, totals: { rewritten: 0, deleted: 0, bytesBefore: 0, bytesAfter: 0 } };
}

function compactBatch(side: Side): boolean {
  const batch = side.database.compactThreadEvents();
  if (batch.failedThread) throw new Error(`Compaction failed: ${batch.failedThread}`);
  side.totals.rewritten += batch.rewritten;
  side.totals.deleted += batch.deleted;
  side.totals.bytesBefore += batch.bytesBefore;
  side.totals.bytesAfter += batch.bytesAfter;
  return !batch.done;
}

function context(side: Side, compacts: boolean): Context {
  const db = side.database.connection;
  const raw = (eventType: string, payload: DynamicRecord) => {
    const snapshot = payload.snapshot;
    const value =
      snapshot && typeof snapshot === "object"
        ? { ...payload, snapshot: { ...snapshot, agentId: side.agentId, threadId: side.threadId } }
        : payload;
    db.prepare(
      `INSERT INTO orchestration_events
         (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, 'thread', ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      `old:${crypto.randomUUID()}`,
      side.threadId,
      eventType,
      new Date(BASE).toISOString(),
      JSON.stringify(value),
    );
  };
  return {
    raw,
    update: (messages, input = {}) =>
      raw(input.eventType ?? UPDATED, {
        detail: input.detail ?? {},
        changedMessages: messages,
        removedMessageIds: input.removed ?? [],
        ...("activeTurnId" in input ? { activeTurnId: input.activeTurnId } : {}),
      }),
    write: (changedMessages, activeTurnId = null) => {
      side.database.persistConversationChanges({
        agentId: side.agentId,
        threadId: side.threadId,
        activeTurnId,
        changedMessages,
        eventType: UPDATED,
      });
    },
    remove: (messageIds, activeTurnId = null) => {
      side.database.rebuildThreadProjection(side.threadId);
      side.database.persistConversationChanges({
        agentId: side.agentId,
        threadId: side.threadId,
        activeTurnId,
        changedMessages: [],
        eventType: UPDATED,
        deletedMessageIds: messageIds,
      });
    },
    compactBatch: () => {
      if (compacts) compactBatch(side);
    },
    compactAll: () => {
      if (compacts) while (compactBatch(side)) {}
    },
    ageCompaction: () => {
      db.prepare("UPDATE thread_event_compaction SET compacted_at = ?").run(
        new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      );
    },
  };
}

interface EventRow {
  sequence: number;
  event_type: string;
  payload_json: string;
}

function events(side: Side): EventRow[] {
  return databaseRows(
    side.database.connection
      .prepare(
        "SELECT sequence, event_type, payload_json FROM orchestration_events WHERE aggregate_id = ? ORDER BY sequence",
      )
      .all(side.threadId),
  ).map((row) => ({
    sequence: Number(row.sequence),
    event_type: String(row.event_type),
    payload_json: String(row.payload_json),
  }));
}

function replayRows(side: Side) {
  const db = side.database.connection;
  const all = (sql: string) => databaseRows(db.prepare(sql).all(side.threadId));
  return {
    messages: all("SELECT * FROM projection_thread_messages WHERE thread_id = ? ORDER BY ordinal"),
    turns: all("SELECT * FROM projection_turns WHERE thread_id = ? ORDER BY turn_id"),
    activities: all(
      `SELECT a.turn_id, a.activity_type, a.payload_json, a.last_event_sequence,
              a.created_at = e.occurred_at AS same_time
       FROM projection_thread_activities a
       LEFT JOIN orchestration_events e ON e.sequence = a.last_event_sequence
       WHERE a.thread_id = ? ORDER BY a.last_event_sequence`,
    ),
    thread: all("SELECT active_turn_id, last_event_sequence FROM projection_threads WHERE thread_id = ?"),
  };
}

function neutral<Value>(side: Side, value: Value): Value {
  return JSON.parse(JSON.stringify(value).replaceAll(side.threadId, "THREAD").replaceAll(side.agentId, "AGENT"));
}

function otherKeysKept(fullSide: Side, full: EventRow[], compactedSide: Side, compacted: EventRow[]): string | null {
  const bySequence = new Map(full.map((event) => [event.sequence, event]));
  for (const event of compacted) {
    const original = bySequence.get(event.sequence);
    if (!original) continue;
    const { changedMessages: before, ...beforeRest } = JSON.parse(original.payload_json);
    const { changedMessages: after, ...afterRest } = JSON.parse(event.payload_json);
    if (
      original.event_type !== event.event_type ||
      !isDeepStrictEqual(neutral(fullSide, beforeRest), neutral(compactedSide, afterRest))
    )
      return `event ${event.sequence} changed a key other than changedMessages`;
    if (Array.isArray(before) !== Array.isArray(after))
      return `event ${event.sequence} changed its changedMessages type`;
    if (!Array.isArray(before)) continue;
    let index = 0;
    for (const item of after) {
      while (
        index < before.length &&
        !isDeepStrictEqual(neutral(fullSide, before[index]), neutral(compactedSide, item))
      )
        index++;
      if (index === before.length) return `event ${event.sequence} has an item that the original does not have`;
      index++;
    }
  }
  return null;
}

async function runCase(test: Case): Promise<CaseReport> {
  const root = await mkdtemp(join(tmpdir(), "openbot-event-compaction-"));
  const full = await openSide(join(root, "full"));
  const compacted = await openSide(join(root, "compacted"));
  try {
    test.run(context(full, false));
    test.run(context(compacted, true));
    while (compactBatch(compacted)) {}
    const fullEvents = events(full);
    const compactedEvents = events(compacted);
    const expected = full.database.rebuildThreadProjection(full.threadId);
    const actual = compacted.database.rebuildThreadProjection(compacted.threadId);
    const replayMatches = isDeepStrictEqual(neutral(compacted, actual), neutral(full, expected));
    const keptSequences = new Set(compactedEvents.map((event) => event.sequence));
    const fullRows = () => {
      const rows = replayRows(full);
      return {
        ...rows,
        activities: rows.activities.filter((row) => keptSequences.has(Number(row.last_event_sequence))),
      };
    };
    const rowsMatch = isDeepStrictEqual(neutral(compacted, replayRows(compacted)), neutral(full, fullRows()));
    const keyDifference = otherKeysKept(full, fullEvents, compacted, compactedEvents);

    compacted.database.connection.prepare("DELETE FROM thread_event_compaction").run();
    const first = compacted.totals.rewritten;
    const deleted = compacted.totals.deleted;
    while (compactBatch(compacted)) {}
    const secondPassRewritten = compacted.totals.rewritten - first;
    compacted.database.connection.prepare("DELETE FROM thread_event_compaction").run();
    const second = compacted.totals.rewritten;
    while (compactBatch(compacted)) {}
    const thirdPassRewritten = compacted.totals.rewritten - second;
    const secondReplay = compacted.database.rebuildThreadProjection(compacted.threadId);
    const laterPassDeleted = compacted.totals.deleted - deleted;

    const result: CaseReport = {
      name: test.name,
      events: fullEvents.length,
      compactedEvents: compactedEvents.length,
      rewritten: first,
      minimumRewritten: test.minimumRewritten,
      deleted,
      minimumDeleted: test.minimumDeleted ?? 0,
      laterPassDeleted,
      bytesBefore: compacted.totals.bytesBefore,
      bytesAfter: compacted.totals.bytesAfter,
      replayMatches: replayMatches && isDeepStrictEqual(neutral(compacted, secondReplay), neutral(full, expected)),
      rowsMatch,
      otherKeysKept: keyDifference === null,
      secondPassRewritten,
      thirdPassRewritten,
      passed: false,
    };
    result.passed =
      result.replayMatches &&
      result.rowsMatch &&
      result.otherKeysKept &&
      result.rewritten >= test.minimumRewritten &&
      result.deleted >= result.minimumDeleted &&
      (test.minimumDeleted === undefined ? result.deleted === 0 : result.compactedEvents === result.events - deleted) &&
      result.laterPassDeleted === 0 &&
      (test.oldEventsLater ? result.secondPassRewritten > 0 : result.secondPassRewritten === 0) &&
      result.thirdPassRewritten === 0 &&
      (result.rewritten === 0 || result.bytesAfter < result.bytesBefore);
    if (keyDifference) result.difference = keyDifference;
    else if (!replayMatches) result.difference = "the rebuilt chats differ";
    else if (!rowsMatch) {
      const left = neutral(compacted, replayRows(compacted));
      const right = neutral(full, fullRows());
      const tables: (keyof typeof right)[] = ["messages", "turns", "activities", "thread"];
      const table = tables.find((key) => !isDeepStrictEqual(left[key], right[key]));
      const index = table ? right[table].findIndex((row, at) => !isDeepStrictEqual(row, left[table][at])) : -1;
      const rowsAt = (side: typeof left) => JSON.stringify(table ? side[table][index] : null);
      result.difference = `the rebuilt ${table} rows differ at ${index}: ${rowsAt(left)} / ${rowsAt(right)}`;
    }
    return result;
  } finally {
    full.database.close();
    compacted.database.close();
    await rm(root, { recursive: true, force: true });
  }
}

try {
  for (const test of cases) report.cases.push(await runCase(test));
  report.passed = report.cases.every((result) => result.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const result of report.cases)
    process.stdout.write(
      `${result.passed ? "ok  " : "FAIL"} ${result.name}: ${result.rewritten} of ${result.events} events rewritten (min ${result.minimumRewritten}), ${result.deleted} deleted (min ${result.minimumDeleted}, later ${result.laterPassDeleted}), ${result.bytesBefore} -> ${result.bytesAfter} bytes, replay ${result.replayMatches ? "matches" : "differs"}, rows ${result.rowsMatch ? "match" : "differ"}, later passes ${result.secondPassRewritten}/${result.thirdPassRewritten}${result.difference ? `, ${result.difference}` : ""}\n`,
    );
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
