import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/side-thread-cache-eviction-e2e");
const SIDE_THREAD_MESSAGES = 20;
const FILLER_THREADS = 10;
const FILLER_MESSAGES = 7;
const FILLER_TEXT = "x".repeat(1_000_000);

type CaseName = "settle-after-eviction" | "held-snapshot-after-eviction";

interface CaseReport {
  name: CaseName;
  loadedWhileEvicted: boolean;
  heldMessages: number;
  publishedAfterEviction: number;
  publishedAfterFollowUp: number;
  storedMessages: number;
  mainSnapshotThread: string | null;
  passed: boolean;
  error?: string;
}

let clock = 0;
function message(prefix: string, index: number, text: string, author: "user" | "assistant"): ConversationMessage {
  clock += 1;
  return {
    id: `${prefix}-${index}`,
    turnId: `${prefix}-turn-${index}`,
    author,
    text,
    createdAt: new Date(Date.UTC(2026, 0, 1) + clock).toISOString(),
    status: "completed",
  };
}

const nextMillisecond = () => new Promise((done) => setTimeout(done, 2));

async function runCase(name: CaseName, result: CaseReport): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-side-thread-eviction-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const published: ConversationSnapshot[] = [];
  const conversation = new ConversationRuntime(
    store,
    (event) => {
      if (event.type === "conversation") published.push(event.snapshot);
    },
    () => store.list(),
  );
  try {
    await runCauseEffect(store.initialize());
    const agent = await runCauseEffect(
      store.createAgent({ name: "Worker", description: "Works", avatarSeed: "side-eviction", avatarHue: null }),
    );
    const mainThreadId = store.ensureThreadIdNow(agent.id);
    const threads = new AgentThreadStore(database);
    const newThread = (title: string) =>
      threads.create({ agentId: agent.id, origin: "user", title, titleSource: "auto" }).threadId;
    const sideThread = newThread("Long task");
    conversation.registerTaskThread(agent.id, sideThread);
    const held = conversation.ensureSnapshot(agent.id, sideThread);
    for (let index = 0; index < SIDE_THREAD_MESSAGES; index += 1)
      held.messages.push(message("side", index, `Step ${index}`, index % 2 === 0 ? "user" : "assistant"));
    conversation.emitConversation(held, "e2e.side-thread-seeded", {});
    conversation.ensureSnapshot(agent.id, mainThreadId);
    await nextMillisecond();

    for (let filler = 0; filler < FILLER_THREADS; filler += 1) {
      const threadId = newThread(`Filler ${filler}`);
      conversation.registerExecutionThread(agent.id, threadId);
      const snapshot = conversation.ensureSnapshot(agent.id, threadId);
      for (let index = 0; index < FILLER_MESSAGES; index += 1)
        snapshot.messages.push(message(`filler-${filler}`, index, FILLER_TEXT, "assistant"));
      conversation.emitConversation(snapshot, "e2e.filler", {});
      await nextMillisecond();
    }

    result.loadedWhileEvicted = conversation.loadedExecutionSnapshot(sideThread) !== undefined;
    result.heldMessages = held.messages.length;
    const settled = name === "settle-after-eviction" ? conversation.executionSnapshot(sideThread) : held;
    assert.ok(settled, "the side thread is still known");
    conversation.emitConversation(settled, "e2e.after-eviction", {});
    result.publishedAfterEviction =
      published.filter((snapshot) => snapshot.threadId === sideThread).at(-1)?.messages.length ?? -1;

    const current = conversation.ensureSnapshot(agent.id, sideThread);
    current.messages.push(message("side", SIDE_THREAD_MESSAGES, "Follow-up after Stop", "user"));
    conversation.emitConversation(current, "e2e.follow-up", {});
    result.publishedAfterFollowUp =
      published.filter((snapshot) => snapshot.threadId === sideThread).at(-1)?.messages.length ?? -1;
    result.storedMessages = database.readConversationPage(
      agent.id,
      sideThread,
      { type: "latest" },
      100,
    ).messages.length;
    result.mainSnapshotThread = conversation.loadedSnapshot(agent.id)?.threadId ?? null;

    assert.equal(result.loadedWhileEvicted, false, "an evicted side thread is not reported as loaded");
    assert.equal(result.heldMessages, SIDE_THREAD_MESSAGES, "eviction does not clear a snapshot that code still holds");
    assert.equal(result.publishedAfterEviction, SIDE_THREAD_MESSAGES, "the update after eviction keeps all messages");
    assert.equal(result.publishedAfterFollowUp, SIDE_THREAD_MESSAGES + 1, "the follow-up shows the whole thread");
    assert.equal(result.storedMessages, SIDE_THREAD_MESSAGES + 1, "no stored message is lost");
    assert.equal(result.mainSnapshotThread, mainThreadId, "the main chat keeps its own thread");
    result.passed = true;
  } finally {
    conversation.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };
for (const name of ["settle-after-eviction", "held-snapshot-after-eviction"] as const) {
  const result: CaseReport = {
    name,
    loadedWhileEvicted: true,
    heldMessages: 0,
    publishedAfterEviction: 0,
    publishedAfterFollowUp: 0,
    storedMessages: 0,
    mainSnapshotThread: null,
    passed: false,
  };
  report.cases.push(result);
  try {
    await runCase(name, result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
}
report.passed = report.cases.every((result) => result.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const result of report.cases)
  process.stdout.write(
    `${result.passed ? "PASS" : "FAIL"} ${result.name}: published ${result.publishedAfterEviction} then ${result.publishedAfterFollowUp}${result.error ? ` (${result.error})` : ""}\n`,
  );
process.stdout.write(`passed: ${report.passed}, report: ${join(OUT, "report.json")}\n`);
if (!report.passed) process.exit(1);
