import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { withTransaction } from "../src/backend/database/sqlite-transaction";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const NAME = "large-chat-save-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const TARGET_EVENTS = Number(process.env.LARGE_CHAT_EVENTS ?? 300_000);
const AGENT_ID = "large-chat-agent";
const THREAD_ID = `openbot-thread-${AGENT_ID}`;
const FILLER = "The team checked the release plan, the open questions, and the next steps for each owner. ".repeat(3);
const print = (line: string) => process.stdout.write(`${line}\n`);

interface Timing {
  operation: string;
  ms: number;
}

function timed<T>(timings: Timing[], operation: string, run: () => T): T {
  const started = performance.now();
  const result = run();
  const ms = Math.round((performance.now() - started) * 10) / 10;
  timings.push({ operation, ms });
  print(`${operation}: ${ms} ms`);
  return result;
}

function agentSummary(): AgentSummary {
  return {
    id: AGENT_ID,
    provider: "codex",
    name: "Large chat",
    title: "Large chat",
    description: "",
    notifications: false,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: THREAD_ID,
    workspacePath: tmpdir(),
    preview: "No messages yet",
    updatedAt: new Date().toISOString(),
    avatarSeed: AGENT_ID,
    avatarHue: null,
    avatarUrl: null,
  };
}

function message(index: number, start: number, status: ConversationMessage["status"]): ConversationMessage {
  const author = index % 3 === 0 ? "user" : "assistant";
  return {
    id: `large-chat-message-${index}`,
    author,
    source: author,
    turnId: `large-chat-turn-${Math.floor(index / 3)}`,
    text: `Large chat message ${index}. ${FILLER}`,
    createdAt: new Date(start + index * 1_000).toISOString(),
    status,
  };
}

function seed(database: OpenBotDatabase): { messages: number; events: number } {
  const start = Date.now() - (TARGET_EVENTS + 1_000) * 1_000;
  let events = 0;
  let index = 0;
  const connection = database.connection;
  const batch = 2_000;
  while (events < TARGET_EVENTS) {
    withTransaction(connection, () => {
      for (let step = 0; step < batch && events < TARGET_EVENTS; step += 1) {
        const streaming = message(index, start, "streaming");
        database.appendConversationMessage({
          agentId: AGENT_ID,
          threadId: THREAD_ID,
          activeTurnId: streaming.turnId ?? null,
          message: streaming,
          eventType: "item.started",
        });
        events += 1;
        database.persistConversationChanges({
          agentId: AGENT_ID,
          threadId: THREAD_ID,
          activeTurnId: null,
          changedMessages: [{ ...streaming, status: "completed" }],
          eventType: "item.completed",
        });
        events += 1;
        index += 1;
      }
    });
  }
  return { messages: index, events };
}

const root = await mkdtemp(join(tmpdir(), "openbot-large-chat-"));
const timings: Timing[] = [];
try {
  mkdirSync(OUT, { recursive: true });
  const userData = join(root, "user-data");
  const cachedSeed = join(OUT, `seed-${TARGET_EVENTS}`);
  const seeded = { messages: Math.ceil(TARGET_EVENTS / 2), events: Math.ceil(TARGET_EVENTS / 2) * 2 };
  let database: OpenBotDatabase;
  if (process.argv.includes("--reuse-seed") && existsSync(cachedSeed)) {
    cpSync(cachedSeed, userData, { recursive: true });
    print(`Reused the seeded chat in ${cachedSeed}.`);
  } else {
    database = new OpenBotDatabase(userData);
    await runCauseEffect(database.initialize());
    database.replaceAgents("large-chat:agent", [agentSummary()], "agent.created");
    Object.assign(
      seeded,
      timed(timings, "seed", () => seed(database)),
    );
    print(`Seeded ${seeded.messages} messages and ${seeded.events} chat events.`);
    database.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database.close();
    if (process.argv.includes("--reuse-seed")) {
      cpSync(userData, cachedSeed, { recursive: true });
      rmSync(join(cachedSeed, "openbot.db-wal"), { force: true });
      rmSync(join(cachedSeed, "openbot.db-shm"), { force: true });
    }
  }

  database = new OpenBotDatabase(userData);
  const openStarted = performance.now();
  await runCauseEffect(database.initialize());
  timings.push({ operation: "open database", ms: Math.round((performance.now() - openStarted) * 10) / 10 });
  const now = Date.now();
  const fresh: ConversationMessage = {
    id: randomUUID(),
    author: "assistant",
    source: "assistant",
    turnId: "large-chat-turn-live",
    text: "",
    createdAt: new Date(now).toISOString(),
    status: "streaming",
  };
  timed(timings, "append message", () =>
    database.appendConversationMessage({
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      activeTurnId: fresh.turnId ?? null,
      message: fresh,
      eventType: "item.started",
    }),
  );
  for (let delta = 1; delta <= 3; delta += 1) {
    const streamed = { ...fresh, text: `${FILLER.slice(0, delta * 40)}` };
    timed(timings, `stream delta ${delta}`, () =>
      database.persistStreamingMessage({
        snapshot: {
          agentId: AGENT_ID,
          threadId: THREAD_ID,
          activeTurnId: fresh.turnId ?? null,
          revision: 0,
          messages: [streamed],
        },
        messageId: fresh.id,
        eventType: "item.delta",
      }),
    );
  }
  timed(timings, "complete message", () =>
    database.persistConversationChanges({
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      activeTurnId: null,
      changedMessages: [{ ...fresh, text: FILLER, status: "completed" }],
      eventType: "item.completed",
      detail: { turnId: fresh.turnId, status: "completed" },
    }),
  );
  const latest = timed(timings, "read latest page", () =>
    database.readConversationPage(AGENT_ID, THREAD_ID, { type: "latest" }, 100),
  );
  const full = timed(timings, "read full chat", () => database.readConversation(AGENT_ID, THREAD_ID));
  const revisionBefore = full.revision;
  const revisionAfter = timed(timings, "stream a message outside the loaded window", () =>
    database.persistStreamingMessage({
      snapshot: {
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        activeTurnId: latest.activeTurnId,
        revision: latest.revision,
        messages: latest.messages,
      },
      messageId: "large-chat-message-outside-window",
      eventType: "response.delta-flushed",
    }),
  );
  const kept = database.readConversation(AGENT_ID, THREAD_ID);
  assert.equal(kept.messages.length, full.messages.length, "A stream flush outside the window removed messages.");
  assert.equal(revisionAfter, revisionBefore, "A stream flush outside the window wrote an event.");
  timed(timings, "delete one message", () =>
    database.persistConversationChanges({
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      activeTurnId: null,
      changedMessages: [],
      deletedMessageIds: ["large-chat-message-10"],
      eventType: "message.deleted",
    }),
  );
  timed(timings, "has history event", () => database.threadHasEvent(THREAD_ID, "thread.history-imported"));
  timed(timings, "latest summary", () => database.latestThreadSummary(THREAD_ID));
  timed(timings, "compact chat events", () => database.compactThreadEvents());
  database.close();

  const report = {
    name: NAME,
    createdAt: new Date().toISOString(),
    targetEvents: TARGET_EVENTS,
    seeded,
    fullChatMessages: full.messages.length,
    latestPageMessages: latest.messages.length,
    messagesAfterWindowFlush: kept.messages.length,
    timings,
  };
  const reportPath = join(OUT, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  print(`Report: ${reportPath}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
