import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { settleQuietRoutineTurn } from "../src/backend/agent/routine-quiet-runs";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const out = resolve(import.meta.dirname, "../.openbot-build/routine-silent-thread-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-silent-thread-"));
const database = new OpenBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
const unused = () => Effect.die("Browser use is outside this fixture.");
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const checks: { name: string; passed: boolean; actual: unknown }[] = [];
let service: AgentService | undefined;
let error: string | undefined;
const originalEnsure = ConversationRuntime.prototype.ensureSnapshot;
try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Thread fixture", description: "Synthetic", avatarSeed: "fixture", avatarHue: null }),
  );
  const routine = new AgentRoutineStore(database).create({
    agentId: agent.id,
    name: "Silent thread",
    instruction: "Keep alerts.",
    timezone: "UTC",
    active: false,
    schedule: { kind: "hourly", minute: 0 },
    silent: true,
  });
  const task = new AgentThreadStore(database).create({
    agentId: agent.id,
    origin: "agent",
    title: routine.name,
    titleSource: "agent",
    routineId: routine.id,
  });
  service = new AgentService({ store, mailbox, browser });
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  const runtimes: ConversationRuntime[] = [];
  ConversationRuntime.prototype.ensureSnapshot = function (agentId, threadId) {
    runtimes.push(this);
    return originalEnsure.call(this, agentId, threadId);
  };
  service.readTask(agent.id, task.taskId);
  ConversationRuntime.prototype.ensureSnapshot = originalEnsure;
  const runtime = runtimes[0];
  assert.ok(runtime, "The public task read must use the production runtime.");
  const snapshot = runtime.ensureSnapshot(agent.id, task.threadId);
  const answer: ConversationMessage = {
    id: "quiet-answer",
    author: "assistant",
    source: "agent",
    text: "[[no-update]] Nothing changed.",
    createdAt: "2026-11-01T12:00:00.000Z",
    status: "completed",
    turnId: "fixture-turn",
    itemType: "message",
  };
  const cursor: ConversationMessage = {
    id: "visible-cursor",
    author: "assistant",
    source: "agent",
    text: "A useful report stays.",
    createdAt: "2026-11-01T12:00:01.000Z",
    status: "completed",
    turnId: "report-turn",
  };
  snapshot.messages.push(answer);
  settleQuietRoutineTurn(snapshot, "fixture-turn", true, true);
  assert.equal(
    snapshot.messages.find((message) => message.id === answer.id)?.silentRoutineStatus,
    true,
    "The production quiet producer must flag the fixture answer.",
  );
  snapshot.messages.push(cursor);
  runtime.emitConversation(snapshot);
  const full = service.readTask(agent.id, task.taskId);
  const page = service.readTaskPage({ agentId: agent.id, taskId: task.taskId, beforeMessageId: cursor.id, limit: 100 });
  const live = events.filter((event) => event.type === "agent-task-conversation").at(-1);
  const liveSnapshot = live && "snapshot" in live ? live.snapshot : undefined;
  const stored = database.readConversation(agent.id, task.threadId);
  checks.push({
    name: "The hot full task read hides the quiet answer.",
    passed: !full.messages.some((message) => message.id === answer.id),
    actual: full.messages.map((message) => message.id),
  });
  checks.push({
    name: "The task page hides the quiet answer.",
    passed: !page.conversation.messages.some((message) => message.id === answer.id),
    actual: page.conversation.messages.map((message) => message.id),
  });
  checks.push({
    name: "The live task event hides the quiet answer and keeps the report.",
    passed: Boolean(
      liveSnapshot &&
        !liveSnapshot.messages.some((message) => message.id === answer.id) &&
        liveSnapshot.messages.some((message) => message.id === cursor.id),
    ),
    actual: liveSnapshot?.messages.map((message) => message.id) ?? events.map((event) => event.type),
  });
  checks.push({
    name: "Durable history keeps both rows.",
    passed:
      stored.messages.some((message) => message.id === answer.id) &&
      stored.messages.some((message) => message.id === cursor.id),
    actual: stored.messages.map((message) => message.id),
  });
  const cold = new AgentService({ store, mailbox, browser });
  try {
    const restarted = cold.readTask(agent.id, task.taskId);
    checks.push({
      name: "A cold full task read hides the same quiet answer.",
      passed: !restarted.messages.some((message) => message.id === answer.id),
      actual: restarted.messages.map((message) => message.id),
    });
  } finally {
    await runCauseEffect(cold.stop());
  }
  for (const check of checks) assert.ok(check.passed, `${check.name} Actual ${JSON.stringify(check.actual)}`);
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  ConversationRuntime.prototype.ensureSnapshot = originalEnsure;
  if (service) await runCauseEffect(service.stop());
  database.close();
  await mkdir(out, { recursive: true });
  const report = {
    passed: !error,
    checks,
    error,
    scope:
      "Production AgentService full and page task reads, quiet producer, live publisher, and isolated SQLite. Runtime capture is temporary instrumentation. No provider, native rendering, or live profile is used.",
  };
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await rm(root, { recursive: true, force: true });
}
if (error) process.exitCode = 1;
