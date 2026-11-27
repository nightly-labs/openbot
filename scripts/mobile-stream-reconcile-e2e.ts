import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { replyCatchUpStep } from "../apps/mobile/src/features/chat/model/reply-catch-up";
import { createStreamRevealPool } from "../apps/mobile/src/features/chat/model/stream-reveal-pool";
import { MobileConversationStore } from "../apps/mobile/src/features/workspace/model/conversation-store";

type Delta = Extract<AgentEvent, { type: "conversation-delta" }>;

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-stream-reconcile-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const NEW_THREAD = "thread-2";
const TURN = "turn-1";
const REPLY = "reply-1";
const CREATED_AT = "2026-11-27T10:00:00.000Z";
const REVEAL_STEP_MS = 32;
const REVEAL_BURST_LIMIT_MS = 900;
const CATCH_UP_LIMIT_MS = 450;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFrames() {
  let pending: (() => void) | null = null;
  return {
    schedule(flush: () => void) {
      pending = flush;
      return () => {
        if (pending === flush) pending = null;
      };
    },
    run() {
      const flush = pending;
      pending = null;
      flush?.();
    },
  };
}

const userMessage: ConversationMessage = {
  id: "user-1",
  turnId: TURN,
  author: "user",
  source: "user",
  text: "Tell me a story.",
  createdAt: CREATED_AT,
  status: "completed",
};

function toolMessage(): ConversationMessage {
  return {
    id: "tool-1",
    turnId: TURN,
    author: "assistant",
    source: "assistant",
    itemType: "tool",
    text: "Read notes.md",
    createdAt: CREATED_AT,
    status: "completed",
  };
}

function page(revision: number, messages: ConversationMessage[], threadId = THREAD): ConversationPage {
  return {
    agentId: AGENT,
    threadId,
    activeTurnId: TURN,
    revision,
    messages,
    references: {},
    pageInfo: { hasOlder: false, olderCursor: null },
  };
}

function delta(revision: number, text: string, threadId = THREAD): Delta {
  return {
    type: "conversation-delta",
    agentId: AGENT,
    threadId,
    turnId: TURN,
    messageId: REPLY,
    delta: text,
    createdAt: CREATED_AT,
    revision,
  };
}

function replyText(store: MobileConversationStore) {
  return store.get(AGENT)?.messages.find((message) => message.id === REPLY)?.text ?? "";
}

function replyMessage(text: string): ConversationMessage {
  return {
    id: REPLY,
    turnId: TURN,
    author: "assistant",
    source: "assistant",
    text,
    createdAt: CREATED_AT,
    status: "streaming",
  };
}

function words(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => ({ revision: from + index, text: `w${from + index} ` }));
}

function invalidationLoads(store: MobileConversationStore, revision: number, start: () => void) {
  if (store.get(AGENT) && !store.holdsRevision(AGENT, revision) && store.invalidate(AGENT)) start();
}

async function streamWithInvalidation() {
  const frames = createFrames();
  const store = new MobileConversationStore(frames.schedule);
  store.applyPage(page(10, [userMessage]));
  const unsubscribe = store.subscribe(AGENT, () => {});
  const before = words(11, 15);
  for (const word of before) {
    store.enqueue(delta(word.revision, word.text));
    frames.run();
  }
  const fetched = deferred<ConversationPage>();
  let fetches = 0;
  let load: Promise<ConversationPage> | undefined;
  invalidationLoads(store, 16, () => {
    load = store.loadLatest(
      AGENT,
      () => {
        fetches += 1;
        return fetched.promise;
      },
      () => true,
      true,
    );
  });
  await Promise.resolve();
  const during = words(17, 25);
  const timeline: { revision: number; shownBeforePage: boolean; text: string }[] = [];
  let expected = before.map((word) => word.text).join("");
  for (const word of during) {
    store.enqueue(delta(word.revision, word.text));
    frames.run();
    expected += word.text;
    const text = replyText(store);
    timeline.push({ revision: word.revision, shownBeforePage: text === expected, text });
  }
  const pageText = [...before, ...words(17, 20)].map((word) => word.text).join("");
  fetched.resolve(page(20, [userMessage, toolMessage(), replyMessage(pageText)]));
  await load;
  const afterPage = replyText(store);
  const after = words(26, 28);
  for (const word of after) {
    store.enqueue(delta(word.revision, word.text));
    frames.run();
  }
  const entry = store.get(AGENT);
  const finalText = replyText(store);
  const fullText = [...before, ...during, ...after].map((word) => word.text).join("");
  const order = finalText
    .trim()
    .split(/\s+/u)
    .map((part) => Number(part.slice(1)));
  unsubscribe();
  check("stream: the invalidation starts one fetch", fetches === 1, { fetches });
  check(
    "stream: each delta shows while the fetch runs",
    timeline.every((item) => item.shownBeforePage),
    timeline,
  );
  check("stream: the page keeps the deltas that are newer than it", afterPage === expected, { afterPage, expected });
  check("stream: the text has each word once and in order", finalText === fullText, { finalText, fullText });
  check(
    "stream: the order of the words is strictly increasing",
    order.every((value, index) => index === 0 || value > (order[index - 1] ?? 0)),
    order,
  );
  check("stream: the tool message from the page is kept", Boolean(entry?.messages.some((m) => m.id === "tool-1")), {
    ids: entry?.messages.map((message) => message.id),
  });
  check("stream: the revision is the newest delta", entry?.revision === 28, { revision: entry?.revision });
  return { fetches, timeline, afterPage, finalText, order, revision: entry?.revision };
}

async function newerPageDropsOldDeltas() {
  const frames = createFrames();
  const store = new MobileConversationStore(frames.schedule);
  store.applyPage(page(10, [userMessage]));
  const unsubscribe = store.subscribe(AGENT, () => {});
  const fetched = deferred<ConversationPage>();
  const load = store.loadLatest(
    AGENT,
    () => fetched.promise,
    () => true,
    true,
  );
  await Promise.resolve();
  for (const word of words(11, 13)) {
    store.enqueue(delta(word.revision, word.text));
    frames.run();
  }
  for (const word of words(14, 15)) store.enqueue(delta(word.revision, word.text));
  const pageText = words(11, 15)
    .map((word) => word.text)
    .join("");
  fetched.resolve(page(15, [userMessage, replyMessage(pageText)]));
  await load;
  frames.run();
  const text = replyText(store);
  unsubscribe();
  check("newer page: deltas at or below the page revision are dropped", text === pageText, { text, pageText });
  return { text, revision: store.get(AGENT)?.revision };
}

async function threadSwitchDuringLoad() {
  const frames = createFrames();
  const store = new MobileConversationStore(frames.schedule);
  store.applyPage(page(10, [userMessage]));
  const unsubscribe = store.subscribe(AGENT, () => {});
  const fetched = deferred<ConversationPage>();
  const load = store.loadLatest(
    AGENT,
    () => fetched.promise,
    () => true,
    true,
  );
  await Promise.resolve();
  const streamed = words(11, 15);
  for (const word of streamed) {
    store.enqueue(delta(word.revision, word.text, NEW_THREAD));
    frames.run();
  }
  fetched.resolve(page(10, [userMessage], NEW_THREAD));
  await load;
  const entry = store.get(AGENT);
  const text = replyText(store);
  const expected = streamed.map((word) => word.text).join("");
  unsubscribe();
  check("thread switch: the page of the new thread keeps the deltas of that thread", text === expected, {
    text,
    expected,
    threadId: entry?.threadId,
  });
  check("thread switch: the revision is the newest delta", entry?.revision === 15, { revision: entry?.revision });
  return { text, threadId: entry?.threadId, revision: entry?.revision };
}

function readStateInvalidation() {
  const frames = createFrames();
  const store = new MobileConversationStore(frames.schedule);
  store.applyPage(page(10, [userMessage]));
  const unsubscribe = store.subscribe(AGENT, () => {});
  for (const word of words(11, 14)) store.enqueue(delta(word.revision, word.text));
  let loads = 0;
  invalidationLoads(store, 14, () => {
    loads += 1;
  });
  frames.run();
  invalidationLoads(store, 14, () => {
    loads += 1;
  });
  invalidationLoads(store, 15, () => {
    loads += 1;
  });
  unsubscribe();
  check("read state: an invalidation that a queued delta holds starts no fetch", loads === 1, {
    loads,
    expected: "only revision 15 fetches",
  });
  return { loads };
}

async function revealBurst() {
  const pool = createStreamRevealPool();
  const started: number[] = [];
  let skipped = 0;
  const done = deferred<void>();
  const total = 40;
  const begin = performance.now();
  for (let index = 0; index < total; index += 1) {
    pool.add({
      start: (finish) => {
        started.push(performance.now() - begin);
        setTimeout(finish, 150);
        if (started.length === total) done.resolve();
      },
      skip: () => {
        skipped += 1;
      },
    });
  }
  await Promise.race([done.promise, new Promise((wait) => setTimeout(wait, 5_000))]);
  pool.clear();
  const lastStartMs = Math.round(started.at(-1) ?? Number.POSITIVE_INFINITY);
  check("reveal: a burst of 40 words skips no waiting word", started.length === total, {
    started: started.length,
    skippedBeforeStart: total - started.length,
  });
  check("reveal: a burst of 40 words starts within the limit", lastStartMs <= REVEAL_BURST_LIMIT_MS, {
    lastStartMs,
    limitMs: REVEAL_BURST_LIMIT_MS,
  });
  const slow = createStreamRevealPool();
  const slowStarts: number[] = [];
  const slowDone = deferred<void>();
  const slowBegin = performance.now();
  for (let index = 0; index < 3; index += 1) {
    slow.add({
      start: (finish) => {
        slowStarts.push(performance.now() - slowBegin);
        finish();
        if (slowStarts.length === 3) slowDone.resolve();
      },
      skip: () => {},
    });
  }
  await slowDone.promise;
  slow.clear();
  const gaps = slowStarts.slice(1).map((value, index) => Math.round(value - (slowStarts[index] ?? 0)));
  check(
    "reveal: a short queue keeps one word per step",
    gaps.every((gap) => gap >= REVEAL_STEP_MS - 8),
    { gaps },
  );
  return { startedMs: started.map(Math.round), skipped, slowGapsMs: gaps };
}

function catchUp() {
  const rows = [5, 40, 200, 2_000].map((remaining) => {
    const step = replyCatchUpStep(remaining);
    const steps = Math.ceil(remaining / step);
    return { remaining, step, steps, durationMs: steps * REVEAL_STEP_MS };
  });
  check(
    "playback: the catch-up at the end of a reply is bounded",
    rows.every((row) => row.durationMs <= CATCH_UP_LIMIT_MS),
    rows,
  );
  check(
    "playback: the catch-up uses more than one frame for a long tail",
    rows.filter((row) => row.remaining >= 40).every((row) => row.steps > 1),
    rows,
  );
  return rows;
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const stream = await streamWithInvalidation();
  const newerPage = await newerPageDropsOldDeltas();
  const threadSwitch = await threadSwitchDuringLoad();
  const readState = readStateInvalidation();
  const reveal = await revealBurst();
  const catchUpRows = catchUp();
  const passed = checks.every((item) => item.passed);
  const report = {
    status: passed ? "passed" : "failed",
    stream,
    newerPage,
    threadSwitch,
    readState,
    reveal,
    catchUp: catchUpRows,
    checks,
  };
  const reportPath = join(OUT, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const logger = createOpenBotLogger("mobile-stream-reconcile-e2e");
  for (const item of checks) {
    if (item.passed) logger.info(`ok ${item.name}`);
    else logger.error(`FAIL ${item.name}`);
  }
  logger.info(`Report: ${reportPath}`);
  return passed ? 0 : 1;
}

process.exit(await run());
