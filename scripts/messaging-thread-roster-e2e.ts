import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MessagingStore } from "../src/backend/messaging/messaging-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-thread-roster-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-thread-roster-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Report {
  messagingThreadId?: string;
  threadAfterRestart?: string | null;
  threadAfterRestartShared?: string | null;
  messagingThreadKept?: boolean;
  sharedThreadIsExecution?: boolean;
  otherThreadIsExecution?: boolean;
  passed: boolean;
}

const report: Report = { passed: false };

async function boot<T>(use: (store: AgentStore, database: OpenBotDatabase) => T | Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  await runCauseEffect(store.initialize());
  try {
    return await use(store, database);
  } finally {
    database.close();
  }
}

try {
  const { agentId, messagingThreadId } = await boot(async (store, database) => {
    const agent = await runCauseEffect(
      store.createAgent({ name: "Discord Orchestrator", description: "", avatarSeed: "seed", avatarHue: null }),
    );
    assert.equal(agent.threadId, null);
    const messaging = new MessagingStore(database);
    const connection = messaging.ensureConnection("discord", "guild-1", "Guild");
    const link = messaging.ensureLink({
      connectionId: connection.connectionId,
      agentId: agent.id,
      platformChannelId: "channel-1",
      threadKey: "thread-1",
      isDirect: false,
      title: "#general · hello",
    });
    return { agentId: agent.id, messagingThreadId: link.threadId };
  });
  report.messagingThreadId = messagingThreadId;

  report.threadAfterRestart = await boot(
    (store) => store.list().find((agent) => agent.id === agentId)?.threadId ?? null,
  );
  assert.notEqual(report.threadAfterRestart, messagingThreadId, "A restart adopted the messaging thread.");

  await boot((store, database) => {
    const agents = store
      .list()
      .map((agent) => (agent.id === agentId ? { ...agent, threadId: messagingThreadId } : agent));
    database.replaceAgents("messaging-thread-roster-e2e:seed", agents, "thread.reclaimed");
  });

  await boot((store, database) => {
    report.threadAfterRestartShared = store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
    assert.equal(report.threadAfterRestartShared, messagingThreadId, "The agent lost the thread with its chat.");
    const messaging = new MessagingStore(database);
    report.messagingThreadKept = messaging.linkForThread(messagingThreadId)?.agentId === agentId;
    assert.ok(report.messagingThreadKept, "The messaging thread lost its link.");
    const other = messaging.ensureLink({
      connectionId: messaging.ensureConnection("discord", "guild-1", "Guild").connectionId,
      agentId,
      platformChannelId: "channel-1",
      threadKey: "thread-2",
      isDirect: false,
      title: "#general · again",
    });
    const conversation = new ConversationRuntime(
      store,
      () => {},
      () => store.list(),
    );
    for (const threadId of [messagingThreadId, other.threadId]) conversation.registerExecutionThread(agentId, threadId);
    report.sharedThreadIsExecution = conversation.isExecutionThread(messagingThreadId);
    report.otherThreadIsExecution = conversation.isExecutionThread(other.threadId);
    assert.equal(report.sharedThreadIsExecution, false, "The agent's own chat got a second snapshot.");
    assert.equal(report.otherThreadIsExecution, true, "A conversation thread lost its execution snapshot.");
    conversation.dispose();
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Messaging thread roster check passed. Report: ${join(OUT, "report.json")}\n`);
