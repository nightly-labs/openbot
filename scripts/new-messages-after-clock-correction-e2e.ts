import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/new-messages-after-clock-correction-e2e");
const FAST_CLOCK_MS = 3 * 60 * 60 * 1000;
const FUTURE_TURNS = 60;

type CaseName = "clock-corrected" | "mailbox-copy-keeps-moved-time" | "normal-clock" | "older-history";

interface CaseReport {
  name: CaseName;
  latestPageTail: string[];
  publishedTail: string[];
  times: Record<string, string>;
  passed: boolean;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };

function message(id: string, turnId: string, author: "user" | "assistant", createdAt: number): ConversationMessage {
  return { id, turnId, author, text: id, createdAt: new Date(createdAt).toISOString(), status: "completed" };
}

function futureTurns(now: number): ConversationMessage[] {
  return Array.from({ length: FUTURE_TURNS }, (_, index) => {
    const at = now + FAST_CLOCK_MS - (FUTURE_TURNS - index) * 60_000;
    return [
      message(`future-prompt-${index}`, `future-turn-${index}`, "user", at),
      message(`future-reply-${index}`, `future-turn-${index}`, "assistant", at + 1),
    ];
  }).flat();
}

async function runCase(name: CaseName, result: CaseReport): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-clock-correction-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const published: ConversationSnapshot[] = [];
  const conversation = new ConversationRuntime(
    store,
    (event: AgentEvent) => {
      if (event.type === "conversation") published.push(event.snapshot);
    },
    () => store.list(),
  );
  try {
    await runCauseEffect(store.initialize());
    const agent = await runCauseEffect(
      store.createAgent({ name: "Clock", description: "Answers", avatarSeed: "clock", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);
    const now = Date.now();
    const pastPrompt = message("past-prompt", "past-turn", "user", now - 60 * 60 * 1000);
    const seeded: ConversationSnapshot = {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: name === "normal-clock" ? [pastPrompt] : [pastPrompt, ...futureTurns(now)],
    };
    conversation.emitConversation(seeded, "e2e.seeded", {});

    const held = conversation.ensureSnapshot(agent.id, threadId);
    const sentAt = Date.now();
    const prompt = message("new-prompt", "new-turn", "user", sentAt);
    const reply = message("new-reply", "new-turn", "assistant", sentAt + 1);
    const history = message("older-history", "history-turn", "user", now - 2 * 60 * 60 * 1000);
    held.messages.push(...(name === "older-history" ? [history] : [prompt, reply]));
    conversation.emitConversation(held);

    if (name === "mailbox-copy-keeps-moved-time") {
      const index = held.messages.findIndex((candidate) => candidate.id === prompt.id);
      held.messages[index] = {
        ...message(prompt.id, prompt.turnId ?? "", "user", sentAt),
        delivery: { id: prompt.id, status: "completed", position: null },
      };
      conversation.emitConversation(held);
    }

    const page = database.readConversationPage(agent.id, threadId, { type: "latest" }, 40);
    const stored = new Map(
      database.connection
        .prepare("SELECT message_id, created_at FROM projection_thread_messages WHERE thread_id = ?")
        .all(threadId)
        .map((row) => [String(row.message_id), String(row.created_at)]),
    );
    result.latestPageTail = page.messages.slice(-3).map((candidate) => candidate.id);
    result.publishedTail = (published.at(-1)?.messages ?? []).slice(-3).map((candidate) => candidate.id);
    result.times = Object.fromEntries(
      ["past-prompt", `future-reply-${FUTURE_TURNS - 1}`, prompt.id, reply.id, history.id].flatMap((id) => {
        const time = stored.get(id);
        return time === undefined ? [] : [[id, time]];
      }),
    );

    if (name === "older-history") {
      assert.equal(stored.get(history.id), history.createdAt, "older history keeps its own time");
      assert.ok(!result.latestPageTail.includes(history.id), "older history is not moved to the end");
    } else if (name === "normal-clock") {
      assert.equal(stored.get(prompt.id), prompt.createdAt, "a normal clock keeps the prompt time");
      assert.equal(stored.get(reply.id), reply.createdAt, "a normal clock keeps the reply time");
      assert.deepEqual(result.latestPageTail.slice(-2), [prompt.id, reply.id]);
    } else {
      const newestFuture = stored.get(`future-reply-${FUTURE_TURNS - 1}`) ?? "";
      assert.ok((stored.get(prompt.id) ?? "") > newestFuture, "the new prompt is saved after the future messages");
      assert.ok((stored.get(reply.id) ?? "") > (stored.get(prompt.id) ?? ""), "the reply stays after its prompt");
      assert.deepEqual(result.latestPageTail.slice(-2), [prompt.id, reply.id], "the latest page ends with them");
      assert.deepEqual(result.publishedTail.slice(-2), [prompt.id, reply.id], "the live chat ends with them");
      assert.equal(
        held.messages.find((candidate) => candidate.id === prompt.id)?.createdAt,
        stored.get(prompt.id),
        "the live chat and the database have the same time",
      );
    }
    result.passed = true;
  } finally {
    conversation.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

const names: CaseName[] = ["clock-corrected", "mailbox-copy-keeps-moved-time", "normal-clock", "older-history"];
for (const name of names) {
  const result: CaseReport = { name, latestPageTail: [], publishedTail: [], times: {}, passed: false };
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
    `${result.passed ? "PASS" : "FAIL"} ${result.name}: ends with ${result.latestPageTail.join(", ")}${result.error ? ` (${result.error})` : ""}\n`,
  );
process.stdout.write(`passed: ${report.passed}, report: ${join(OUT, "report.json")}\n`);
if (!report.passed) process.exit(1);
