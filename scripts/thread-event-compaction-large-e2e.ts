// Measures the compaction of old thread events on a large database (plan 011, item 23).
//
//   bun scripts/thread-event-compaction-large-e2e.ts [--size-gb=1.5]
//
// It makes a database with the latest schema and fills `orchestration_events` to `--size-gb` with events
// of the shape that releases before #8166 and #8794 wrote: each conversation update has every message
// of its thread. The mix follows a hosted server: `conversation.snapshot-updated` 71%,
// `conversation.mailbox-reconciled` 13% (with queued deliveries that move), `turn.started` 2%, and
// streamed flushes and appended messages, which have no message list. One long thread has a quarter of
// the bytes, so the kill below lands inside a thread.
//
// Then it rebuilds each thread from its events (`rebuildThreadProjection`) and keeps a hash of the
// result. A child process opens the database as a start does and runs the batch loop of a start. The
// script kills it with SIGKILL after 30 batches, starts it again to the end, and starts it a third time,
// which must rewrite nothing. It samples the free disk and the WAL during each run. At the end it
// rebuilds each thread again and compares the hashes, and checks that each event row keeps its sequence,
// id, command, type, time and every payload key other than `changedMessages`.
//
// Writes `.openbot-build/thread-event-compaction-large/report.json` and exits non-zero on a failure. The
// report holds sizes, times and counts only, no message text.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Duration, Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase, type ThreadEventCompactionBatch } from "../src/backend/openbot-database";
import { compactThreadEvents } from "../src/backend/thread-event-compaction-run";

const OUT = resolve(import.meta.dirname, "../.openbot-build/thread-event-compaction-large");
const GIB = 1024 ** 3;
const KILL_AFTER_BATCHES = 30;
const BASE = Date.UTC(2026, 3, 1);

function flag(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function fileBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function freeBytes(path: string): number {
  const stats = statfsSync(path);
  return stats.bavail * stats.bsize;
}

function rows(db: DatabaseSync, sql: string, ...parameters: Array<string | number>) {
  return db
    .prepare(sql)
    .all(...parameters)
    .map((row) => {
      if (!isDynamicRecord(row)) throw new Error(`Unexpected row shape from: ${sql}`);
      return row;
    });
}

function numberOf(db: DatabaseSync, sql: string, ...parameters: Array<string | number>): number {
  const value = rows(db, sql, ...parameters)[0]?.n;
  return isNumber(value) ? value : 0;
}

// ---------------------------------------------------------------------------------------------------
// Child: open the database as a start does and run the batch loop. One line for each batch, then the
// result, so the parent can kill it after a number of batches.

interface ChildResult {
  seconds: number;
  threads: number;
  events: number;
  rewritten: number;
  bytesBefore: number;
  bytesAfter: number;
  batches: number;
  failedThreads: Record<string, number>;
  /** Each batch is one write transaction on the main thread of the app. */
  batchMs: { p50: number; p99: number; max: number };
  slowestBatch: { index: number; events: number; rewritten: number; bytesBefore: number };
}

async function runCompactionChild(root: string, pauseMs: number): Promise<ChildResult> {
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const batchTimes: number[] = [];
  let slowestBatch = { index: -1, events: 0, rewritten: 0, bytesBefore: 0 };
  const timed = {
    compactThreadEvents(): ThreadEventCompactionBatch {
      const started = performance.now();
      const batch = database.compactThreadEvents();
      const ms = performance.now() - started;
      if (ms > Math.max(0, ...batchTimes))
        slowestBatch = {
          index: batchTimes.length,
          events: batch.events,
          rewritten: batch.rewritten,
          bytesBefore: batch.bytesBefore,
        };
      batchTimes.push(ms);
      if (!batch.done) process.stdout.write(`batch ${batchTimes.length}\n`);
      return batch;
    },
  };
  const started = performance.now();
  const result = await Effect.runPromise(compactThreadEvents(timed, Duration.millis(pauseMs)));
  const seconds = (performance.now() - started) / 1000;
  database.close();
  const sorted = batchTimes.toSorted((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
  return { seconds, ...result, batchMs: { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? 0 }, slowestBatch };
}

const child = flag("child");
if (child === "compact") {
  const root = flag("root");
  if (!root) throw new Error("The child needs --root.");
  const result = await runCompactionChild(root, Number(flag("pause-ms") ?? "5"));
  process.stdout.write(`result ${JSON.stringify(result)}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------
// Parent.

const sizeGb = Number(flag("size-gb") ?? "1.5");
if (!(sizeGb > 0)) throw new Error("Usage: bun scripts/thread-event-compaction-large-e2e.ts [--size-gb=<GB>]");
const targetBytes = sizeGb * GIB;

rmSync(OUT, { recursive: true, force: true });
const root = join(OUT, "user-data");
const home = join(OUT, "home");
const temp = join(OUT, "tmp");
mkdirSync(root, { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(temp, { recursive: true });
if (freeBytes(OUT) < targetBytes * 2.5) {
  throw new Error(`This run needs ${((targetBytes * 2.5) / GIB).toFixed(1)} GB of free disk in ${OUT}.`);
}
const databasePath = join(root, "openbot.db");

// ----- Generate

const FILL = 'Lorem ipsum dolor sit amet, 界 "quoted" \\ path/to/file.ts:12 '.repeat(40);

function message(threadIndex: number, index: number, edit = 0): ConversationMessage {
  const author = index % 3 === 0 ? "user" : "agent";
  return {
    id: `t${threadIndex}-m${index}`,
    author,
    text: `${edit > 0 ? `Edit ${edit}: ` : ""}${FILL.slice(index % 37, (index % 37) + 300 + ((index * 53) % 500))}`,
    createdAt: new Date(BASE + threadIndex * 86_400_000 + index * 60_000).toISOString(),
    status: "completed",
    reactions: [],
    reaction: null,
    ...(author === "agent" ? { turnId: `t${threadIndex}-turn-${Math.floor(index / 3)}` } : {}),
  };
}

interface Generated {
  seconds: number;
  fileBytes: number;
  threads: number;
  events: Record<string, number>;
  payloadBytes: Record<string, number>;
}

async function generate(): Promise<Generated> {
  const started = performance.now();
  const database = new OpenBotDatabase(root);
  const agentStore = new AgentStore(root, home, database);
  await runCauseEffect(agentStore.initialize());
  const agent = await runCauseEffect(agentStore.getOrCreate("compaction-agent", "Compaction", "Compaction"));
  database.close();

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = OFF");
  const addThread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'Thread', NULL, ?, ?, 0)`,
  );
  const addEvent = db.prepare(
    `INSERT INTO orchestration_events
       (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
     VALUES (?, ?, 'thread', ?, ?, ?, ?)`,
  );
  const events: Record<string, number> = {};
  const payloadBytes: Record<string, number> = {};
  let total = 0;
  let pending = 0;
  let eventIndex = 0;
  const add = (threadId: string, eventType: string, payload: DynamicRecord) => {
    const json = JSON.stringify(payload);
    eventIndex += 1;
    addEvent.run(
      `event-${eventIndex}`,
      `old:${eventIndex}`,
      threadId,
      eventType,
      new Date(BASE + eventIndex * 1000).toISOString(),
      json,
    );
    events[eventType] = (events[eventType] ?? 0) + 1;
    payloadBytes[eventType] = (payloadBytes[eventType] ?? 0) + json.length;
    total += json.length;
    pending += 1;
    if (pending >= 2_000) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      pending = 0;
    }
  };

  /**
   * One thread: a chat that grows to `length` messages, then `extra` updates of the whole chat, and
   * more of them until all events have `untilBytes`.
   */
  const writeThread = (threadIndex: number, threadId: string, length: number, extra: number, untilBytes = 0) => {
    const time = new Date(BASE + threadIndex * 86_400_000).toISOString();
    addThread.run(threadId, agent.id, time, time);
    const chat: ConversationMessage[] = [];
    for (let step = 0; step < length + extra || total < untilBytes; step++) {
      if (step < length) {
        const added = message(threadIndex, step);
        // An agent message streams first, and a user message is appended first.
        if (added.author === "agent") {
          add(threadId, "response.delta-flushed", {
            detail: {},
            streamedMessage: { ...added, status: "streaming", text: added.text.slice(0, 120) },
            activeTurnId: added.turnId,
          });
        } else {
          add(threadId, "message.appended", { detail: {}, appendedMessage: added, activeTurnId: null });
        }
        chat.push(added);
      } else if (step % 5 === 0) {
        const index = step % chat.length;
        chat[index] = message(threadIndex, index, step);
      }
      const activeTurnId = step % 3 === 1 ? `t${threadIndex}-turn-${Math.floor(step / 3)}` : null;
      if (step % 50 === 0 && step > 0) {
        add(threadId, "turn.started", {
          detail: { turnId: activeTurnId },
          changedMessages: chat,
          removedMessageIds: [],
          activeTurnId,
        });
      } else if (step % 6 === 0) {
        // A queue whose position and time move on each reconcile.
        const queued = [1, 2].map((position) => ({
          ...message(threadIndex, 10_000 + position),
          author: "user" as const,
          createdAt: new Date(BASE + threadIndex * 86_400_000 + step * 60_000 + position).toISOString(),
          delivery: { id: `t${threadIndex}-q${position}`, status: "queued", position: position + (step % 2) },
        }));
        add(threadId, "conversation.mailbox-reconciled", {
          detail: {},
          changedMessages: [...chat, ...queued],
          removedMessageIds: [],
          activeTurnId,
        });
        add(threadId, "conversation.mailbox-reconciled", {
          detail: {},
          changedMessages: chat,
          removedMessageIds: queued.map((entry) => entry.id),
          activeTurnId,
        });
      } else {
        add(threadId, "conversation.snapshot-updated", {
          detail: {},
          changedMessages: chat,
          removedMessageIds: [],
          activeTurnId,
        });
      }
    }
  };

  db.exec("BEGIN");
  // The long thread, with a quarter of the bytes. Its id sorts first, so the kill lands in it.
  writeThread(0, "thread-a-long", 120, 400, targetBytes * 0.25);
  let threadIndex = 1;
  while (total < targetBytes) {
    writeThread(threadIndex, `thread-b-${String(threadIndex).padStart(5, "0")}`, 40 + (threadIndex % 30), 10);
    threadIndex += 1;
  }
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return {
    seconds: (performance.now() - started) / 1000,
    fileBytes: fileBytes(databasePath),
    threads: threadIndex,
    events,
    payloadBytes,
  };
}

// ----- Inspect

interface TableSize {
  /** Pages of `orchestration_events` and its indexes (`dbstat`). */
  tableAndIndexBytes: number;
  /** Free bytes inside those pages. */
  unusedBytes: number;
  payloadBytes: number;
  rows: number;
  fileBytes: number;
  freelistBytes: number;
}

function tableSize(db: DatabaseSync): TableSize {
  const pageSize = numberOf(db, "SELECT page_size AS n FROM pragma_page_size");
  return {
    tableAndIndexBytes: numberOf(
      db,
      `SELECT SUM(pgsize) AS n FROM dbstat WHERE name IN
        (SELECT name FROM sqlite_master WHERE tbl_name = 'orchestration_events')`,
    ),
    unusedBytes: numberOf(
      db,
      `SELECT SUM(unused) AS n FROM dbstat WHERE name IN
        (SELECT name FROM sqlite_master WHERE tbl_name = 'orchestration_events')`,
    ),
    payloadBytes: numberOf(db, "SELECT SUM(length(CAST(payload_json AS BLOB))) AS n FROM orchestration_events"),
    rows: numberOf(db, "SELECT COUNT(*) AS n FROM orchestration_events"),
    fileBytes: fileBytes(databasePath),
    freelistBytes: numberOf(db, "SELECT freelist_count AS n FROM pragma_freelist_count") * pageSize,
  };
}

/** One hash of every event row without its message list: what compaction must not change. */
function eventRowsHash(db: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const row of db
    .prepare(
      `SELECT sequence, event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at,
              json_remove(payload_json, '$.changedMessages') AS rest,
              json_type(payload_json, '$.changedMessages') AS list
       FROM orchestration_events ORDER BY sequence`,
    )
    .iterate()) {
    hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}

/** The hash of each thread's replay: the chat, and the message, turn, activity and thread rows. */
async function replayHashes(): Promise<Map<string, string>> {
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const db = database.connection;
  const hashes = new Map<string, string>();
  const threads = rows(db, "SELECT thread_id FROM projection_threads ORDER BY thread_id").map((row) =>
    String(row.thread_id),
  );
  for (const threadId of threads) {
    const conversation = database.rebuildThreadProjection(threadId);
    const hash = createHash("sha256");
    hash.update(JSON.stringify(conversation));
    for (const sql of [
      "SELECT * FROM projection_thread_messages WHERE thread_id = ? ORDER BY ordinal",
      "SELECT * FROM projection_turns WHERE thread_id = ? ORDER BY turn_id",
      `SELECT turn_id, activity_type, payload_json, created_at, last_event_sequence
       FROM projection_thread_activities WHERE thread_id = ? ORDER BY last_event_sequence`,
      "SELECT active_turn_id, last_event_sequence FROM projection_threads WHERE thread_id = ?",
    ])
      hash.update(JSON.stringify(db.prepare(sql).all(threadId)));
    hashes.set(threadId, hash.digest("hex"));
  }
  database.close();
  return hashes;
}

// ----- Measure

interface Measured {
  result: ChildResult | null;
  killed: boolean;
  batchesSeen: number;
  peakExtraDiskBytes: number;
  peakWalBytes: number;
  walBytesAfter: number;
  wallSeconds: number;
}

function parseChildResult(value: unknown): ChildResult {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.batchMs) || !isDynamicRecord(value.slowestBatch))
    throw new Error("The child printed no result.");
  const failed = isDynamicRecord(value.failedThreads) ? value.failedThreads : {};
  return {
    seconds: Number(value.seconds),
    threads: Number(value.threads),
    events: Number(value.events),
    rewritten: Number(value.rewritten),
    bytesBefore: Number(value.bytesBefore),
    bytesAfter: Number(value.bytesAfter),
    batches: Number(value.batches),
    failedThreads: Object.fromEntries(Object.entries(failed).map(([name, count]) => [name, Number(count)])),
    batchMs: { p50: Number(value.batchMs.p50), p99: Number(value.batchMs.p99), max: Number(value.batchMs.max) },
    slowestBatch: {
      index: Number(value.slowestBatch.index),
      events: Number(value.slowestBatch.events),
      rewritten: Number(value.slowestBatch.rewritten),
      bytesBefore: Number(value.slowestBatch.bytesBefore),
    },
  };
}

/** Runs the child to the end, or kills it with SIGKILL after `killAfter` batches. */
function runChild(killAfter: number | null): Promise<Measured> {
  return new Promise((resolvePromise, reject) => {
    const freeBefore = freeBytes(OUT);
    const started = performance.now();
    let peakExtraDiskBytes = 0;
    let peakWalBytes = 0;
    const sample = () => {
      peakExtraDiskBytes = Math.max(peakExtraDiskBytes, freeBefore - freeBytes(OUT));
      peakWalBytes = Math.max(peakWalBytes, fileBytes(`${databasePath}-wal`));
    };
    const timer = setInterval(sample, 25);
    const compaction = spawn(
      process.execPath,
      [import.meta.filename, "--child=compact", `--root=${root}`, "--pause-ms=5"],
      {
        env: { ...process.env, SQLITE_TMPDIR: temp, TMPDIR: temp },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let batchesSeen = 0;
    let result: ChildResult | null = null;
    let killed = false;
    createInterface({ input: compaction.stdout }).on("line", (line) => {
      if (line.startsWith("batch ")) {
        batchesSeen += 1;
        if (killAfter !== null && batchesSeen >= killAfter && !killed) {
          killed = true;
          compaction.kill("SIGKILL");
        }
      } else if (line.startsWith("result ")) result = parseChildResult(JSON.parse(line.slice(7)));
    });
    compaction.on("error", reject);
    compaction.on("close", (code, signal) => {
      clearInterval(timer);
      sample();
      if (!killed && code !== 0) {
        reject(new Error(`The compaction child exited with ${code ?? signal}.`));
        return;
      }
      resolvePromise({
        result,
        killed,
        batchesSeen,
        peakExtraDiskBytes,
        peakWalBytes,
        walBytesAfter: fileBytes(`${databasePath}-wal`),
        wallSeconds: (performance.now() - started) / 1000,
      });
    });
  });
}

const generated = await generate();
const inspect = new DatabaseSync(databasePath);
const before = tableSize(inspect);
const rowsHashBefore = eventRowsHash(inspect);
inspect.close();
const replayStarted = performance.now();
const replaysBefore = await replayHashes();
const replaySeconds = (performance.now() - replayStarted) / 1000;
// The replay writes the projection rows, so the file before compaction is the file after it.
const fileBytesBeforeCompaction = fileBytes(databasePath);

// On a real computer the file is on disk long before the start.
spawnSync("sync");
const killedRun = await runChild(KILL_AFTER_BATCHES);
const progressAfterKill = (() => {
  const db = new DatabaseSync(databasePath);
  try {
    return {
      threadsDone: numberOf(db, "SELECT COUNT(*) AS n FROM thread_event_compaction"),
      longThreadDone: numberOf(
        db,
        "SELECT COUNT(*) AS n FROM thread_event_compaction WHERE thread_id = 'thread-a-long'",
      ),
      integrity: String(rows(db, "PRAGMA integrity_check")[0]?.integrity_check),
    };
  } finally {
    db.close();
  }
})();
const resumed = await runChild(null);
const nextStart = await runChild(null);

const after = new DatabaseSync(databasePath);
const sizeAfter = tableSize(after);
const rowsHashAfter = eventRowsHash(after);
const integrityAfter = String(rows(after, "PRAGMA integrity_check")[0]?.integrity_check);
const threadsDone = numberOf(after, "SELECT COUNT(*) AS n FROM thread_event_compaction");
after.close();
const replaysAfter = await replayHashes();
const replayDifferences = [...replaysBefore].filter(([threadId, hash]) => replaysAfter.get(threadId) !== hash).length;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  command: process.argv.join(" "),
  sizeGb,
  generated,
  before,
  replaySecondsForAllThreads: replaySeconds,
  fileBytesBeforeCompaction,
  fileGrowthBytes: sizeAfter.fileBytes - fileBytesBeforeCompaction,
  killedStart: killedRun,
  progressAfterKill,
  resumedStart: resumed,
  nextStart,
  after: sizeAfter,
  threadsDone,
  integrityAfter,
  replayDifferences,
  acceptance: {
    databaseAtLeast1_4Gb: generated.fileBytes >= 1.4 * 1e9,
    killedInsideTheLongThread: killedRun.killed && progressAfterKill.longThreadDone === 0,
    integrityAfterKill: progressAfterKill.integrity === "ok",
    resumedRunFinished: resumed.result !== null && Object.keys(resumed.result.failedThreads).length === 0,
    everyThreadDone: threadsDone === generated.threads,
    nextStartRewritesNothing: nextStart.result?.rewritten === 0,
    everyEventRowKept: sizeAfter.rows === before.rows && rowsHashAfter === rowsHashBefore,
    everyReplayTheSame: replayDifferences === 0 && replaysAfter.size === replaysBefore.size,
    payloadsSmaller: sizeAfter.payloadBytes < before.payloadBytes * 0.5,
    // The freed pages go to the free list; the progress rows and a few index pages can add some.
    fileGrowsAtMost1Mib: sizeAfter.fileBytes - fileBytesBeforeCompaction <= 1024 ** 2,
    integrityAfter: integrityAfter === "ok",
  },
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
rmSync(root, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
rmSync(temp, { recursive: true, force: true });
const failed = Object.entries(report.acceptance).flatMap(([name, passed]) => (passed ? [] : [name]));
if (failed.length > 0) throw new Error(`Thread event compaction check failed: ${failed.join(", ")}.`);
process.stdout.write(`Thread event compaction check passed. Wrote ${join(OUT, "report.json")}.\n`);
