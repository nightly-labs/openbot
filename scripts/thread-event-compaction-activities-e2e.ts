import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { AgentStore } from "../src/backend/agent-store";
import { databaseRows } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/thread-event-compaction-activities");
const UPDATED = "conversation.snapshot-updated";
const BASE = Date.parse("2026-05-06T12:00:00.000Z");
const OTHER_THREADS = 200;
const OTHER_ACTIVITIES_PER_THREAD = 2_500;
const UPDATE_PAIRS_BEFORE_REPLAY = 300;
const UPDATE_PAIRS_AFTER_REPLAY = 300;
const MAX_INDEXED_BATCH_MS = 1_000;

function message(id: string, minute: number, text: string): ConversationMessage {
  return {
    id,
    author: "agent",
    text,
    createdAt: new Date(BASE + minute * 60_000).toISOString(),
    status: "completed",
    reactions: [],
    reaction: null,
  };
}

interface Run {
  index: boolean;
  activitiesBefore: number;
  otherActivitiesBefore: number;
  otherActivitiesAfter: number;
  threadActivitiesBefore: number;
  threadActivitiesAfter: number;
  keyedActivitiesBefore: number;
  activitiesWithoutEvent: number;
  eventsBefore: number;
  eventsAfter: number;
  deleted: number;
  batches: number;
  batchMs: { p50: number; p99: number; max: number };
  totalMs: number;
  messagesBefore: string;
  messagesAfter: string;
}

function count(database: OpenBotDatabase, sql: string, ...parameters: string[]): number {
  return Number(databaseRows(database.connection.prepare(sql).all(...parameters))[0]?.n ?? 0);
}

function messagesHash(database: OpenBotDatabase, threadId: string): string {
  const conversation = database.rebuildThreadProjection(threadId);
  return createHash("sha256").update(JSON.stringify(conversation.messages)).digest("hex");
}

function addOtherActivities(database: OpenBotDatabase, agentId: string): void {
  const db = database.connection;
  const thread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Other', NULL, ?, ?, 0)`,
  );
  const activity = db.prepare(
    `INSERT INTO projection_thread_activities
       (activity_id, thread_id, turn_id, activity_type, payload_json, created_at, last_event_sequence)
     VALUES (?, ?, NULL, ?, '{}', ?, ?)`,
  );
  const time = new Date(BASE).toISOString();
  db.exec("BEGIN");
  for (let threadIndex = 0; threadIndex < OTHER_THREADS; threadIndex++) {
    const threadId = `other-${String(threadIndex).padStart(4, "0")}`;
    thread.run(threadId, agentId, time, time);
    for (let index = 0; index < OTHER_ACTIVITIES_PER_THREAD; index++)
      activity.run(`${threadId}-activity-${index}`, threadId, UPDATED, time, 1_000_000 + index);
  }
  db.exec("COMMIT");
}

async function run(index: boolean): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), "openbot-compaction-activities-"));
  const database = new OpenBotDatabase(join(root, "state"));
  try {
    const store = new AgentStore(join(root, "state"), join(root, "home"), database);
    await runCauseEffect(store.initialize());
    const agent = await runCauseEffect(
      store.createAgent({ name: "Writer", description: "Many updates", avatarSeed: "activities", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);
    if (!index) database.connection.exec("DROP INDEX thread_activities_sequence");
    addOtherActivities(database, agent.id);
    const write = (changedMessages: ConversationMessage[]) =>
      database.persistConversationChanges({
        agentId: agent.id,
        threadId,
        activeTurnId: null,
        changedMessages,
        eventType: UPDATED,
      });
    const writePairs = (from: number, to: number) => {
      for (let step = from; step <= to; step++) {
        write([message("a", 1, `a${step}`)]);
        write([message("b", 2, `b${step}`)]);
      }
    };
    write([message("a", 1, "a0"), message("b", 2, "b0")]);
    writePairs(1, UPDATE_PAIRS_BEFORE_REPLAY);
    database.rebuildThreadProjection(threadId);
    writePairs(UPDATE_PAIRS_BEFORE_REPLAY + 1, UPDATE_PAIRS_BEFORE_REPLAY + UPDATE_PAIRS_AFTER_REPLAY);

    const otherActivities = "SELECT COUNT(*) AS n FROM projection_thread_activities WHERE thread_id LIKE 'other-%'";
    const threadActivities = "SELECT COUNT(*) AS n FROM projection_thread_activities WHERE thread_id = ?";
    const threadEvents = "SELECT COUNT(*) AS n FROM orchestration_events WHERE aggregate_id = ?";
    const before = {
      activities: count(database, "SELECT COUNT(*) AS n FROM projection_thread_activities"),
      other: count(database, otherActivities),
      thread: count(database, threadActivities, threadId),
      keyed: count(
        database,
        `SELECT COUNT(*) AS n FROM projection_thread_activities WHERE thread_id = ? AND activity_id LIKE '${UPDATED}:%'`,
        threadId,
      ),
      events: count(database, threadEvents, threadId),
      messages: messagesHash(database, threadId),
    };
    const times: number[] = [];
    let deleted = 0;
    const started = performance.now();
    for (;;) {
      const batchStarted = performance.now();
      const batch = database.compactThreadEvents();
      times.push(performance.now() - batchStarted);
      if (batch.failedThread) throw new Error(`Compaction failed: ${batch.failedThread}`);
      deleted += batch.deleted;
      if (batch.done) break;
    }
    const totalMs = performance.now() - started;
    const sorted = times.toSorted((left, right) => left - right);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
    const activitiesWithoutEvent = count(
      database,
      `SELECT COUNT(*) AS n FROM projection_thread_activities a
       WHERE a.thread_id = ? AND NOT EXISTS (SELECT 1 FROM orchestration_events e WHERE e.sequence = a.last_event_sequence)`,
      threadId,
    );
    return {
      index,
      activitiesBefore: before.activities,
      otherActivitiesBefore: before.other,
      otherActivitiesAfter: count(database, otherActivities),
      threadActivitiesBefore: before.thread,
      threadActivitiesAfter: count(database, threadActivities, threadId),
      keyedActivitiesBefore: before.keyed,
      activitiesWithoutEvent,
      eventsBefore: before.events,
      eventsAfter: count(database, threadEvents, threadId),
      deleted,
      batches: times.length,
      batchMs: { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? 0 },
      totalMs,
      messagesBefore: before.messages,
      messagesAfter: messagesHash(database, threadId),
    };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

const report: { indexed?: Run; withoutIndex?: Run; checks?: Record<string, boolean>; passed: boolean; error?: string } =
  { passed: false };
try {
  const indexed = await run(true);
  const withoutIndex = await run(false);
  report.indexed = indexed;
  report.withoutIndex = withoutIndex;
  const minimumDeleted = (UPDATE_PAIRS_BEFORE_REPLAY + UPDATE_PAIRS_AFTER_REPLAY) * 2 - 2;
  report.checks = {
    deletesTheSupersededUpdates: indexed.deleted >= minimumDeleted,
    deletesTheirActivities: indexed.activitiesWithoutEvent === 0,
    deletesOneActivityForEachEvent:
      indexed.threadActivitiesBefore - indexed.threadActivitiesAfter === indexed.eventsBefore - indexed.eventsAfter,
    replayedAndKeyedActivities:
      indexed.keyedActivitiesBefore > 0 && indexed.keyedActivitiesBefore < indexed.threadActivitiesBefore,
    keepsOtherThreads: indexed.otherActivitiesAfter === indexed.otherActivitiesBefore,
    keepsTheChat: indexed.messagesAfter === indexed.messagesBefore,
    sameResultWithoutIndex:
      withoutIndex.deleted === indexed.deleted && withoutIndex.threadActivitiesAfter === indexed.threadActivitiesAfter,
    batchesStayShort: indexed.batchMs.max < MAX_INDEXED_BATCH_MS,
  };
  report.passed = Object.values(report.checks).every(Boolean);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const result of [report.indexed, report.withoutIndex])
    if (result)
      process.stdout.write(
        `${result.index ? "with index   " : "without index"}: ${result.deleted} deleted in ${result.batches} batches, batch p50 ${result.batchMs.p50.toFixed(1)} ms, p99 ${result.batchMs.p99.toFixed(1)} ms, max ${result.batchMs.max.toFixed(1)} ms, total ${result.totalMs.toFixed(0)} ms, ${result.activitiesBefore} activities\n`,
      );
  for (const [name, passed] of Object.entries(report.checks ?? {}))
    process.stdout.write(`${passed ? "ok  " : "FAIL"} ${name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
