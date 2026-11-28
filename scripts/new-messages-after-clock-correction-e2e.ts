import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { refreshThreadOrder } from "../src/backend/database/thread-message-order";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/new-messages-after-clock-correction-e2e");
const FAST_CLOCK_MS = 3 * 60 * 60 * 1000;
const FUTURE_TURNS = 60;
const CLOCK_CATCH_UP = "-4 hours";
const CLOCK_CATCH_UP_MS = 4 * 60 * 60 * 1000;
const QUEUED_BEFORE_STEER_MS = 60_000;

type CaseName =
  | "clock-corrected"
  | "reply-listed-first"
  | "mailbox-copy-keeps-moved-time"
  | "clock-caught-up"
  | "normal-clock"
  | "steer-requeued"
  | "older-history";

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
      messages: name === "normal-clock" || name === "steer-requeued" ? [pastPrompt] : [pastPrompt, ...futureTurns(now)],
    };
    conversation.emitConversation(seeded, "e2e.seeded", {});

    const held = conversation.ensureSnapshot(agent.id, threadId);
    const sentAt = Date.now();
    const delivered = (createdAt: number): ConversationMessage => ({
      ...message("new-prompt", "new-turn", "user", createdAt),
      delivery: { id: "new-prompt", status: "completed", position: null },
    });
    const prompt = delivered(sentAt);
    const reply = message("new-reply", "new-turn", "assistant", sentAt + 1);
    const history = message("older-history", "history-turn", "user", now - 2 * 60 * 60 * 1000);
    const added =
      name === "older-history" ? [history] : name === "reply-listed-first" ? [reply, prompt] : [prompt, reply];
    held.messages.push(...added);
    conversation.emitConversation(held);

    if (name === "mailbox-copy-keeps-moved-time") {
      const index = held.messages.findIndex((candidate) => candidate.id === prompt.id);
      held.messages[index] = delivered(sentAt);
      conversation.emitConversation(held);
    }

    if (name === "steer-requeued") {
      const promptIndex = () => held.messages.findIndex((candidate) => candidate.id === prompt.id);
      held.messages[promptIndex()] = { ...delivered(sentAt), steered: true };
      conversation.emitConversation(held);
      held.messages[promptIndex()] = delivered(sentAt - QUEUED_BEFORE_STEER_MS);
      conversation.emitConversation(held);
    }

    if (name === "clock-caught-up") {
      database.connection
        .prepare(
          "UPDATE projection_thread_messages SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ?) WHERE thread_id = ?",
        )
        .run(CLOCK_CATCH_UP, threadId);
      refreshThreadOrder(database.connection, threadId);
      database.persistConversationChanges({
        agentId: agent.id,
        threadId,
        activeTurnId: null,
        changedMessages: [delivered(sentAt - CLOCK_CATCH_UP_MS)],
        eventType: "conversation.mailbox-reconciled",
      });
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
    } else if (name === "steer-requeued") {
      assert.equal(
        stored.get(prompt.id),
        new Date(sentAt - QUEUED_BEFORE_STEER_MS).toISOString(),
        "a requeued steer goes back to its own time",
      );
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
      if (name !== "clock-caught-up")
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

const names: CaseName[] = [
  "clock-corrected",
  "reply-listed-first",
  "mailbox-copy-keeps-moved-time",
  "clock-caught-up",
  "normal-clock",
  "steer-requeued",
  "older-history",
];
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
