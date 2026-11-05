// Real AgentService, SQLite, mailbox and CodexAppServerClient; separate model-free fake process.
// Run: bun scripts/thread-rewrite-service-e2e.ts
// Writes .openbot-build/thread-rewrite-service-e2e/report.json on success and failure.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ConversationMessageSender, type RewriteMessageInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/thread-rewrite-service-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-rewrite-service-"));
const userData = join(root, "profile");
const workspaceHome = join(root, "workspace-home");
const controlPath = join(root, "control.json");
const logPath = join(root, "protocol.jsonl");
const fakePath = join(root, "codex");
const originalEnvironment = {
  HOME: process.env.HOME,
  CODEX_HOME: process.env.CODEX_HOME,
  OPENBOT_CODEX_PATH: process.env.OPENBOT_CODEX_PATH,
};
interface ProtocolEntry {
  pid: number;
  method: string;
  threadId?: string;
  turnId?: string;
  text?: string;
  turnIds?: string[];
  itemIds?: string[];
}
interface Report {
  passed: boolean;
  provider: string;
  checks: Array<{ name: string; passed: boolean; evidence?: object; error?: string }>;
  restarts: Array<{ stoppedProviderPids: number[]; newProviderPids: number[] }>;
  protocol: ProtocolEntry[];
  serviceFailures: Array<{ code: string; agentId?: string; message?: string }>;
  backfills: Array<{ externalSessionId: string; importedTurns: number }>;
  redBeforeImporterFix?: {
    checks: Report["checks"];
    backfills: Report["backfills"];
    serviceFailures: Report["serviceFailures"];
    protocol: ProtocolEntry[];
  };
  error?: string;
  cleanupError?: string;
}
const report: Report = {
  passed: false,
  provider:
    "Real AgentService and CodexAppServerClient adapter; separate deterministic fake Codex app-server child. No live provider or model.",
  checks: [],
  restarts: [],
  protocol: [],
  serviceFailures: [],
  backfills: [],
};
const previousReport: Report | undefined = existsSync(join(OUT, "report.json"))
  ? JSON.parse(readFileSync(join(OUT, "report.json"), "utf8"))
  : undefined;
if (
  previousReport?.checks.some((result) => result.error?.includes("Removed suffix resurrected")) &&
  previousReport.backfills?.length &&
  previousReport.serviceFailures?.length === 0
) {
  report.redBeforeImporterFix = {
    checks: previousReport.checks.filter((result) => !result.passed),
    backfills: previousReport.backfills,
    serviceFailures: previousReport.serviceFailures,
    protocol: previousReport.protocol.filter((entry) => entry.method.startsWith("history/")),
  };
} else if (previousReport?.redBeforeImporterFix) report.redBeforeImporterFix = previousReport.redBeforeImporterFix;
const errorText = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error));
const entries = (): ProtocolEntry[] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const control = (value: { holdUnsubscribeThread?: string; holdTurnText?: string } = {}) => {
  writeFileSync(`${controlPath}.next`, JSON.stringify(value));
  renameSync(`${controlPath}.next`, controlPath);
};
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = read();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 10));
  }
}
async function check(name: string, run: () => Promise<object | undefined>) {
  try {
    const evidence = await run();
    report.checks.push({ name, passed: true, evidence });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    report.checks.push({ name, passed: false, error: errorText(error) });
    process.stderr.write(`FAIL ${name}: ${errorText(error)}\n`);
  }
}
const unused = () => Effect.die(new Error("Browser operation is not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};
function makeService() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, workspaceHome, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    requestTimeoutMs: 20_000,
    memoryReviewInterval: () => 0,
  });
  agents.on("failure", (failure) => report.serviceFailures.push({ code: failure.code, agentId: failure.agentId }));
  agents.on("event", (event) => {
    if (event.type === "error")
      report.serviceFailures.push({ code: event.code, agentId: event.agentId, message: event.message });
  });
  return { database, store, mailbox, agents };
}
let current: ReturnType<typeof makeService> | undefined;
function service() {
  assert.ok(current);
  return current;
}
async function stop() {
  if (!current) return;
  const stopping = current;
  try {
    await runCauseEffect(stopping.agents.stop());
  } finally {
    stopping.database.close();
    current = undefined;
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
};
async function restart(beforeInitialize?: (created: ReturnType<typeof makeService>) => void) {
  const expectedSessions = service()
    .database.connection.prepare(
      "SELECT id, external_session_id, state, updated_at FROM projection_provider_sessions WHERE provider = 'codex'",
    )
    .all()
    .filter((session) => {
      const imported = service().database.providerHistoryImport(String(session.id));
      return (
        session.state !== "inactive" ||
        imported?.state !== "complete" ||
        imported.updatedAt < String(session.updated_at)
      );
    });
  const oldPids = entries()
    .filter((entry) => entry.method === "process/start")
    .map((entry) => entry.pid);
  await stop();
  await waitFor("all old fake provider processes to exit", () => oldPids.every((pid) => !alive(pid)));
  const before = entries().length;
  current = makeService();
  beforeInitialize?.(current);
  await runCauseEffect(current.agents.initialize());
  for (const session of expectedSessions) {
    const sessionId = String(session.id);
    const externalSessionId = String(session.external_session_id);
    const imported = await waitFor(`completed provider backfill for ${externalSessionId}`, () => {
      assert.deepEqual(report.serviceFailures, [], "AgentService reported a failure during provider backfill.");
      const state = service().database.providerHistoryImport(sessionId);
      assert.notEqual(state?.state, "failed", `History import failed for ${externalSessionId}`);
      if (state?.state !== "complete") return false;
      const responses = entries()
        .slice(before)
        .filter((entry) => entry.threadId === externalSessionId);
      const returned = responses.findLast((entry) => entry.method === "history/turns/replied")?.turnIds;
      if (
        !returned?.length ||
        !returned.every((turnId) =>
          responses.some((entry) => entry.method === "history/items/replied" && entry.turnId === turnId),
        )
      )
        return false;
      const turns = service()
        .database.connection.prepare(
          "SELECT turn_id, complete, imported FROM provider_history_turns WHERE session_id = ?",
        )
        .all(sessionId);
      return returned.every((turnId) =>
        turns.some((turn) => turn.turn_id === turnId && turn.complete === 1 && turn.imported === 1),
      )
        ? turns
        : false;
    });
    assert.ok(
      entries()
        .slice(before)
        .some((entry) => entry.method === "history/items/replied" && entry.threadId === externalSessionId),
      `Provider returned no real history items for ${externalSessionId}`,
    );
    report.backfills.push({ externalSessionId, importedTurns: imported.length });
  }
  const newPids = entries()
    .slice(before)
    .filter((entry) => entry.method === "process/start")
    .map((entry) => entry.pid);
  assert.ok(newPids.length > 0, "Restart did not create a new provider process.");
  assert.ok(newPids.every((pid) => !oldPids.includes(pid)));
  report.restarts.push({ stoppedProviderPids: oldPids, newProviderPids: newPids });
}
async function createAgent(name: string) {
  const agent = await runCauseEffect(
    service().agents.createAgent({
      name,
      description: "Synthetic thread rewrite fixture",
      avatarSeed: "rewrite-service",
      avatarHue: null,
      initialMessage: "Fixture setup.",
    }),
  );
  await idle(agent.id, null);
  return agent;
}
async function settled(id: string) {
  const { mailbox } = service();
  const status = await waitFor(`delivery ${id} to settle`, () => {
    const value = mailbox.getDelivery(id)?.delivery.status;
    return value && ["completed", "failed", "interrupted", "cancelled"].includes(value) ? value : null;
  });
  assert.equal(status, "completed", mailbox.getDelivery(id)?.delivery.error ?? `Delivery ${id}: ${status}`);
}
async function idle(agentId: string, taskId: string | null) {
  await waitFor("the conversation lane to become idle", () => {
    const { agents, database, store, mailbox } = service();
    if (taskId) return agents.listTasks(agentId).tasks.find((task) => task.id === taskId)?.state === "idle";
    const thread = store.list().find((agent) => agent.id === agentId)?.threadId;
    return (
      thread &&
      !database.readConversation(agentId, thread).activeTurnId &&
      !mailbox.hasUnfinishedDeliveryOutsideTasks(agentId)
    );
  });
}
async function send(agentId: string, text: string, taskId: string | null = null, sender?: ConversationMessageSender) {
  const receipt = await runCauseEffect(
    service().agents.sendMessage({ agentId, text, ...(taskId ? { taskId } : {}) }, sender),
  );
  const id = receipt.deliveries[0]?.id;
  assert.ok(id);
  await settled(id);
  await idle(agentId, taskId);
  return id;
}
function threadFor(agentId: string, taskId: string | null) {
  const { agents, store } = service();
  const id = taskId
    ? agents.readTask(agentId, taskId).threadId
    : store.list().find((agent) => agent.id === agentId)?.threadId;
  assert.ok(id);
  return id;
}
function sessionFor(threadId: string) {
  const id = service().database.activeProviderSession(threadId, "codex")?.externalSessionId;
  assert.ok(id, `No active provider session for ${threadId}`);
  return id;
}
function archives(threadId: string) {
  return service()
    .database.connection.prepare(
      "SELECT payload_json FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'thread.rewound' ORDER BY sequence",
    )
    .all(threadId)
    .map((row) => String(row.payload_json));
}
function assertAbsent(agentId: string, threadId: string, ids: string[], removedTurns: string[] = []) {
  const messages = service().database.readConversation(agentId, threadId).messages;
  for (const id of ids) assert.ok(!messages.some((message) => message.id === id), `Removed suffix resurrected: ${id}`);
  for (const turnId of removedTurns)
    assert.ok(
      !messages.some((message) => message.turnId === turnId),
      `Removed turn resurrected under another message ID: ${turnId}`,
    );
}
async function rejected(
  input: RewriteMessageInput,
  expected: RegExp,
  sender?: ConversationMessageSender,
  source: "host" | "member" = "member",
) {
  const threadId = threadFor(input.agentId, input.taskId);
  const before = archives(threadId);
  const messages = service().database.readConversation(input.agentId, threadId).messages;
  await assert.rejects(runCauseEffect(service().agents.rewriteMessage(input, sender, source)), expected);
  assert.deepEqual(archives(threadId), before, "Rejected rewrite changed the archive.");
  assert.deepEqual(
    service().database.readConversation(input.agentId, threadId).messages,
    messages,
    "Rejected rewrite changed conversation history.",
  );
}
function rewriteInput(
  agentId: string,
  messageId: string,
  text: string,
  taskId: string | null = null,
): RewriteMessageInput {
  return { agentId, taskId, messageId, text, requestId: randomUUID() };
}
async function bytes(id: string) {
  const file = await runCauseEffect(service().mailbox.resolveAttachment(id));
  assert.ok(file);
  return readFileSync(file.path);
}

try {
  // Only the fake executable changes. HOME and CODEX_HOME retain their original values.
  mkdirSync(workspaceHome, { recursive: true });
  control();
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const fakeSource = resolve(import.meta.dirname, "provider-fakes/thread-rewrite-codex.ts");
  await writeFile(
    fakePath,
    `#!/bin/sh\nexec ${[process.execPath, fakeSource, logPath, controlPath, join(root, "provider-state.json")].map(quote).join(" ")} "$@"\n`,
    { mode: 0o755 },
  );
  process.env.OPENBOT_CODEX_PATH = fakePath;
  current = makeService();
  await runCauseEffect(current.agents.initialize());

  for (const lane of ["main", "side"])
    await check(`${lane}: rewrite, copied files, retry, full restart, deletion`, async () => {
      const agent = await createAgent(`Rewrite ${lane}`);
      let taskId: string | null = null;
      if (lane === "side") {
        const task = await runCauseEffect(service().agents.startTask({ agentId: agent.id, text: "SIDE-PREFIX-KEPT" }));
        taskId = task.id;
        await idle(agent.id, taskId);
      } else await send(agent.id, "MAIN-PREFIX-KEPT");
      const threadId = threadFor(agent.id, taskId);
      const prefixIds = service()
        .database.readConversation(agent.id, threadId)
        .messages.map((message) => message.id);
      const path = join(root, `${lane}-attachment.txt`);
      await writeFile(path, `Attachment bytes for ${lane}.\n`);
      const [attachment] = await runCauseEffect(service().agents.prepareAttachments([path]));
      const [voice] = await runCauseEffect(
        service().agents.prepareVoiceRecording(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7, 8, 9])),
      );
      assert.ok(attachment && voice);
      const sourceReceipt = await runCauseEffect(
        service().agents.sendMessage({
          agentId: agent.id,
          ...(taskId ? { taskId } : {}),
          text: `OLD-${lane}-QUESTION`,
          attachmentDraftIds: [attachment.id],
          voiceRecordingDraftId: voice.id,
        }),
      );
      const sourceId = sourceReceipt.deliveries[0]?.id;
      assert.ok(sourceId);
      await settled(sourceId);
      await idle(agent.id, taskId);
      await send(agent.id, `OLD-${lane}-SUFFIX-SECRET`, taskId);
      const before = service().database.readConversation(agent.id, threadId);
      const source = before.messages.find((message) => message.id === sourceId);
      assert.ok(
        source?.attachments?.[0] && source.voiceRecording,
        `Source must keep attachment and voice before rewrite: ${JSON.stringify(source)}`,
      );
      const sourceAttachment = await bytes(source.attachments[0].id);
      const sourceVoice = await bytes(source.voiceRecording.id);
      const suffixIds = before.messages
        .slice(before.messages.findIndex((message) => message.id === sourceId))
        .map((message) => message.id);
      const suffixTurns = [
        ...new Set(
          before.messages
            .filter((message) => suffixIds.includes(message.id))
            .flatMap((message) => (message.turnId ? [message.turnId] : [])),
        ),
      ];
      const oldSession = sessionFor(threadId);
      const request = rewriteInput(agent.id, sourceId, `NEW-${lane}-QUESTION`, taskId);
      const [receipt, retry] = await Promise.all([
        runCauseEffect(service().agents.rewriteMessage(request, undefined, "host")),
        runCauseEffect(service().agents.rewriteMessage(request, undefined, "host")),
      ]);
      assert.deepEqual(retry, receipt);
      const newId = receipt.deliveries[0]?.id;
      assert.ok(newId);
      await settled(newId);
      await idle(agent.id, taskId);
      assert.equal(threadFor(agent.id, taskId), threadId);
      assertAbsent(agent.id, threadId, suffixIds, suffixTurns);
      const snapshot = service().database.readConversation(agent.id, threadId);
      assert.deepEqual(
        snapshot.messages.slice(0, prefixIds.length).map((message) => message.id),
        prefixIds,
      );
      const rewritten = snapshot.messages.find((message) => message.id === newId);
      assert.ok(rewritten?.attachments?.[0] && rewritten.voiceRecording);
      assert.deepEqual(await bytes(rewritten.attachments[0].id), sourceAttachment);
      assert.deepEqual(await bytes(rewritten.voiceRecording.id), sourceVoice);
      assert.equal(rewritten.voiceRecording.mimeType, source.voiceRecording.mimeType);
      assert.equal(rewritten.attachments[0].name, source.attachments[0].name);
      const newSession = sessionFor(threadId);
      assert.notEqual(newSession, oldSession);
      const archive = archives(threadId);
      assert.equal(archive.length, 1);
      assert.deepEqual(
        JSON.parse(archive[0] ?? "{}").detail.priorMessages,
        before.messages,
        "Archive did not retain the full prior history.",
      );
      for (const id of before.messages.map((message) => message.id))
        assert.ok(archive[0]?.includes(id), `Archive lost ${id}`);
      const newInputs = entries().filter((entry) => entry.method === "turn/input" && entry.threadId === newSession);
      assert.ok(newInputs.some((entry) => entry.text?.includes(`NEW-${lane}-QUESTION`)));
      assert.ok(
        newInputs.every(
          (entry) =>
            !entry.text?.includes(`OLD-${lane}-QUESTION`) && !entry.text?.includes(`OLD-${lane}-SUFFIX-SECRET`),
        ),
      );
      await restart();
      assertAbsent(agent.id, threadId, suffixIds, suffixTurns);
      assert.deepEqual(archives(threadId), archive);
      const restoredRetry = await runCauseEffect(service().agents.rewriteMessage(request, undefined, "host"));
      assert.equal(restoredRetry.messageId, receipt.messageId);
      assert.deepEqual(
        restoredRetry.deliveries.map((delivery) => delivery.id),
        receipt.deliveries.map((delivery) => delivery.id),
      );
      await send(agent.id, `AFTER-${lane}-RESTART`, taskId);
      assertAbsent(agent.id, threadId, suffixIds, suffixTurns);
      assert.deepEqual(archives(threadId), archive);
      const resumedInputs = entries().filter(
        (entry) => entry.method === "turn/input" && entry.threadId === sessionFor(threadId),
      );
      assert.ok(
        resumedInputs.every(
          (entry) =>
            !entry.text?.includes(`OLD-${lane}-QUESTION`) && !entry.text?.includes(`OLD-${lane}-SUFFIX-SECRET`),
        ),
      );
      assert.deepEqual(await bytes(rewritten.attachments[0].id), sourceAttachment);
      assert.deepEqual(await bytes(rewritten.voiceRecording.id), sourceVoice);
      const attachmentIds = [
        source.attachments[0].id,
        source.voiceRecording.id,
        rewritten.attachments[0].id,
        rewritten.voiceRecording.id,
      ];
      const attachmentPaths: string[] = [];
      for (const id of attachmentIds) {
        const file = await runCauseEffect(service().mailbox.resolveAttachment(id));
        assert.ok(file && existsSync(file.path));
        attachmentPaths.push(file.path);
      }
      const connection = service().database.connection;
      const mailboxAttachmentRows = () =>
        connection
          .prepare(
            "SELECT attachment_id FROM projection_attachments WHERE owner_kind = 'mailbox-message' AND attachment_id IN (?, ?, ?, ?)",
          )
          .all(...attachmentIds);
      assert.ok(archives(threadId).length > 0, "The thread must retain history before deletion.");
      assert.ok(mailboxAttachmentRows().length > 0, "The mailbox must hold attachment references before deletion.");
      if (taskId) await runCauseEffect(service().agents.deleteTask({ agentId: agent.id, taskId }));
      else await runCauseEffect(service().agents.deleteAgent(agent.id));
      assert.deepEqual(archives(threadId), [], "Deleting the thread left its rewound history behind.");
      assert.deepEqual(
        connection.prepare("SELECT message_id FROM projection_thread_messages WHERE thread_id = ?").all(threadId),
        [],
      );
      assert.deepEqual(
        connection
          .prepare(
            "SELECT attachment_id FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id >= ? AND owner_id < ?",
          )
          .all(`${threadId}:`, `${threadId};`),
        [],
        "Deleting the thread left its attachment references behind.",
      );
      assert.deepEqual(mailboxAttachmentRows(), [], "Deleting the thread left mailbox attachment references behind.");
      for (const id of attachmentIds) assert.equal(await runCauseEffect(service().mailbox.resolveAttachment(id)), null);
      for (const path of attachmentPaths)
        assert.equal(existsSync(path), false, "Deleting the thread left a file behind.");
      return {
        threadId,
        oldSession,
        newSession,
        removedIds: suffixIds,
        removedTurns: suffixTurns,
        archiveCount: archive.length,
        attachmentBytes: sourceAttachment.length,
        voiceBytes: sourceVoice.length,
        idempotentDelivery: newId,
        followedUpAfterCompletedBackfill: true,
        retainedHistoryAndAttachmentReferencesDeleted: true,
      };
    });

  for (const lane of ["main", "side"])
    await check(`${lane}: busy running and queued lanes reject rewrite`, async () => {
      const agent = await createAgent(`Busy ${lane} rewrite`);
      const taskId =
        lane === "side"
          ? (await runCauseEffect(service().agents.startTask({ agentId: agent.id, text: "BUSY-SIDE-PREFIX" }))).id
          : null;
      if (taskId) await idle(agent.id, taskId);
      const source = await send(agent.id, "BUSY-ORIGINAL", taskId);
      const logStart = entries().length;
      control({ holdTurnText: `BUSY-${lane}-RUNNING` });
      const running = await runCauseEffect(
        service().agents.sendMessage({
          agentId: agent.id,
          ...(taskId ? { taskId } : {}),
          text: `BUSY-${lane}-RUNNING`,
        }),
      );
      await waitFor("held busy turn", () =>
        entries()
          .slice(logStart)
          .some((entry) => entry.method === "turn/held"),
      );
      const runningId = running.deliveries[0]?.id;
      assert.ok(runningId);
      await waitFor("running delivery", () => service().mailbox.getDelivery(runningId)?.delivery.status === "running");
      await rejected(
        rewriteInput(agent.id, source, "MUST-NOT-RUN", taskId),
        /busy|running|queued|working|work|空闲|忙|运行/i,
      );
      const queued = await runCauseEffect(
        service().agents.sendMessage({ agentId: agent.id, ...(taskId ? { taskId } : {}), text: "BUSY-QUEUED" }),
      );
      const queuedId = queued.deliveries[0]?.id;
      assert.ok(queuedId);
      assert.equal(service().mailbox.getDelivery(queuedId)?.delivery.status, "queued");
      await rejected(
        rewriteInput(agent.id, source, "MUST-NOT-RUN-EITHER", taskId),
        /busy|running|queued|working|work|空闲|忙|运行/i,
      );
      control();
      await settled(runningId);
      await settled(queuedId);
      await idle(agent.id, taskId);
      // A real queued delivery without a running turn isolates the queued-only rejection.
      const queuedOnly = await runCauseEffect(
        service().mailbox.enqueue({
          sender: { kind: "user" },
          recipientAgentIds: [agent.id],
          ...(taskId ? { taskId } : {}),
          text: "BUSY-QUEUED-ONLY",
        }),
      );
      const queuedOnlyId = queuedOnly.deliveries[0]?.id;
      assert.ok(queuedOnlyId);
      assert.equal(service().database.readConversation(agent.id, threadFor(agent.id, taskId)).activeTurnId, null);
      assert.equal(service().mailbox.getDelivery(queuedOnlyId)?.delivery.status, "queued");
      await rejected(
        rewriteInput(agent.id, source, "MUST-NOT-PASS-QUEUED-ONLY", taskId),
        /busy|running|queued|working|work|空闲|忙|运行/i,
      );
      service().mailbox.cancelNow(agent.id, queuedOnlyId);
      return { runningId, queuedId, queuedOnlyId };
    });

  await check("pending durable intent recovers before its first provider turn", async () => {
    const agent = await createAgent("Pending recovery");
    await send(agent.id, "RECOVERY-PREFIX");
    const source = await send(agent.id, "RECOVERY-OLD-QUESTION");
    await send(agent.id, "RECOVERY-OLD-SUFFIX");
    const threadId = threadFor(agent.id, null);
    const before = service().database.readConversation(agent.id, threadId);
    const suffix = before.messages
      .slice(before.messages.findIndex((message) => message.id === source))
      .map((message) => message.id);
    const oldSession = sessionFor(threadId);
    const logStart = entries().length;
    // Commit through the real mailbox, without scheduling a drain: this is the durable crash window.
    const receipt = await runCauseEffect(
      service().mailbox.enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [agent.id],
        text: "RECOVERY-NEW-QUESTION",
        rewriteSource: { threadId, messageId: source },
        idempotencyKey: "pending-recovery-fixture",
      }),
    );
    const id = receipt.deliveries[0]?.id;
    assert.ok(id);
    assert.equal(service().mailbox.getDelivery(id)?.delivery.status, "queued");
    assert.equal(service().mailbox.nextQueued(agent.id), null);
    assert.ok(service().database.readConversationMessages(agent.id, threadId, [source]).length);
    assert.ok(
      !entries()
        .slice(logStart)
        .some((entry) => entry.text?.includes("RECOVERY-NEW-QUESTION")),
    );
    await assert.rejects(
      restart(({ database }) => {
        database.rewindConversation = () => {
          assert.equal(database.activeProviderSession(threadId, "codex"), null);
          throw new Error("Injected recovery cut failure");
        };
      }),
      /Injected recovery cut failure/,
    );
    assert.deepEqual(service().database.readConversation(agent.id, threadId), before);
    assert.deepEqual(archives(threadId), [], "Failed recovery archived history without cutting it.");
    assert.equal(service().database.activeProviderSession(threadId, "codex"), null);
    assert.equal(service().mailbox.nextQueued(agent.id), null, "Failed recovery released the rewrite delivery.");
    assert.ok(
      service()
        .mailbox.pendingRewrites()
        .some((intent) => intent.deliveryId === id),
    );
    let atFirstTurn: { sourceAbsent: boolean; archiveCount: number } | undefined;
    let sessionRetiredBeforeRewind = false;
    await restart(({ agents, database }) => {
      const rewind = database.rewindConversation.bind(database);
      database.rewindConversation = (...args) => {
        database.rewindConversation = rewind;
        assert.equal(
          database.activeProviderSession(threadId, "codex"),
          null,
          "Recovery cut active history before retiring the old provider session.",
        );
        sessionRetiredBeforeRewind = true;
        return rewind(...args);
      };
      agents.on("event", (event) => {
        if (event.type !== "turn-started" || event.agentId !== agent.id) return;
        atFirstTurn = {
          sourceAbsent: database.readConversationMessages(agent.id, threadId, suffix).length === 0,
          archiveCount: Number(
            database.connection
              .prepare(
                "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'thread.rewound'",
              )
              .get(threadId)?.count,
          ),
        };
      });
    });
    // Recovery must have cut the suffix when initialize returns, even if the new turn has not run yet.
    assertAbsent(agent.id, threadId, suffix);
    assert.equal(sessionRetiredBeforeRewind, true);
    const archive = archives(threadId);
    assert.equal(archive.length, 1);
    for (const message of before.messages) assert.ok(archive[0]?.includes(message.id));
    await settled(id);
    await idle(agent.id, null);
    assert.deepEqual(
      atFirstTurn,
      { sourceAbsent: true, archiveCount: 1 },
      "Pending recovery did not cut and archive before turn-started.",
    );
    const provider = sessionFor(threadId);
    assert.notEqual(provider, oldSession);
    const inputs = entries()
      .slice(logStart)
      .filter((entry) => entry.method === "turn/input");
    assert.equal(inputs.filter((entry) => entry.text?.includes("RECOVERY-NEW-QUESTION")).length, 1);
    assert.ok(
      inputs.every(
        (entry) => !entry.text?.includes("RECOVERY-OLD-QUESTION") && !entry.text?.includes("RECOVERY-OLD-SUFFIX"),
      ),
    );
    assert.deepEqual(archives(threadId), archive);
    return {
      deliveryId: id,
      oldSession,
      newSession: provider,
      removedIds: suffix,
      archiveCount: archive.length,
      atFirstTurn,
      failedRecoveryHeldIntentUntilRetry: true,
    };
  });

  await check("routine enqueue cannot cross the pending rewrite cut", async () => {
    const agent = await createAgent("Routine race");
    await send(agent.id, "RACE-PREFIX");
    const source = await send(agent.id, "RACE-OLD-QUESTION");
    await send(agent.id, "RACE-OLD-SUFFIX");
    const threadId = threadFor(agent.id, null);
    const oldSession = sessionFor(threadId);
    const routine = service().agents.createRoutine({
      agentId: agent.id,
      name: "Race routine",
      instruction: "RACE-ROUTINE",
      active: false,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const mailbox = service().mailbox;
    const originalEnqueue = mailbox.enqueue;
    const originalLock = mailbox.withEnqueueLock.bind(mailbox);
    let attempted = false;
    let acquiredBeforeCut = false;
    let routineEnqueuedBeforeCut = false;
    const cutPending = () => service().database.readConversationMessages(agent.id, threadId, [source]).length > 0;
    // Observe public boundaries only; keep the real enqueue, lock and persistence unchanged.
    mailbox.enqueue = (input: Parameters<MailboxStore["enqueue"]>[0]) => {
      if (input.sender.kind !== "routine") return originalEnqueue(input);
      return Effect.gen(function* () {
        attempted = true;
        const receipt = yield* originalEnqueue(input);
        routineEnqueuedBeforeCut = cutPending();
        return receipt;
      });
    };
    mailbox.withEnqueueLock = (use) =>
      originalLock((enqueue) => {
        if (attempted && cutPending()) acquiredBeforeCut = true;
        return use(enqueue);
      });
    const logStart = entries().length;
    control({ holdUnsubscribeThread: oldSession });
    const rewrite = runCauseEffect(
      service().agents.rewriteMessage(rewriteInput(agent.id, source, "RACE-NEW-QUESTION"), undefined, "host"),
    );
    rewrite.catch(() => {});
    let routineRun: Promise<Awaited<ReturnType<typeof runRoutine>>> | undefined;
    function runRoutine() {
      return runCauseEffect(service().agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
    }
    try {
      await waitFor("unsubscribe held after final validation", () =>
        entries()
          .slice(logStart)
          .some((entry) => entry.method === "unsubscribe/held" && entry.threadId === oldSession),
      );
      assert.ok(mailbox.pendingRewrites().some((intent) => intent.messageId === source));
      assert.ok(service().database.readConversationMessages(agent.id, threadId, [source]).length);
      routineRun = runRoutine();
      routineRun.catch(() => {});
      await waitFor("real routine enqueue attempt", () => attempted);
      // The semaphore acquisition runs synchronously. Flush runnable work without an elapsed-time wait.
      await new Promise<void>((done) => setImmediate(done));
      assert.equal(acquiredBeforeCut, false, "Routine acquired the mailbox lock while unsubscribe was held.");
      assert.equal(routineEnqueuedBeforeCut, false, "Routine persisted a delivery before the rewrite cut.");
      assert.ok(
        !mailbox.conversationMessages(agent.id).some((message) => message.text.includes("RACE-ROUTINE")),
        "Routine reached the mailbox before the cut.",
      );
    } finally {
      control();
      mailbox.enqueue = originalEnqueue;
      mailbox.withEnqueueLock = originalLock;
      await rewrite;
      if (routineRun) {
        const run = await routineRun;
        assert.ok(run.deliveryId);
        await settled(run.deliveryId);
      }
    }
    await idle(agent.id, null);
    assert.equal(acquiredBeforeCut, false, "Routine acquired the mailbox lock before the database cut.");
    assert.equal(routineEnqueuedBeforeCut, false);
    const log = entries().slice(logStart);
    const releasedAt = log.findIndex(
      (entry) => entry.method === "unsubscribe/replied" && entry.threadId === oldSession,
    );
    const routineAt = log.findIndex((entry) => entry.method === "turn/input" && entry.text?.includes("RACE-ROUTINE"));
    assert.ok(releasedAt >= 0 && routineAt > releasedAt);
    return {
      oldSession,
      enqueueAttemptedWhileCutPending: attempted,
      acquiredBeforeCut,
      routineEnqueuedBeforeCut,
      unsubscribeReplyIndex: releasedAt,
      routineTurnIndex: routineAt,
      redBaseline: "Not run: main patch was already present. No main source files changed by this script.",
    };
  });

  for (const lane of ["main", "side"])
    await check(`${lane}: sender ownership uses exact mailbox provenance when projection loses sender`, async () => {
      const owner = { id: "fixture-owner", name: "Fixture owner" };
      const other = { id: "fixture-other", name: "Fixture other" };
      const agent = await createAgent(`Ownership ${lane}`);
      const taskId =
        lane === "side"
          ? (await runCauseEffect(service().agents.startTask({ agentId: agent.id, text: "OWNER-SIDE-PREFIX" }, owner)))
              .id
          : null;
      if (taskId) await idle(agent.id, taskId);
      const source = await send(agent.id, "OWNED-QUESTION", taskId, owner);
      const threadId = threadFor(agent.id, taskId);
      service()
        .database.connection.prepare(
          "UPDATE projection_thread_messages SET message_json = json_remove(message_json, '$.senderMember') WHERE thread_id = ? AND message_id = ?",
        )
        .run(threadId, source);
      assert.equal(
        service().database.readConversationMessages(agent.id, threadId, [source])[0]?.senderMember,
        undefined,
      );
      assert.equal(service().mailbox.messageSender(agent.id, taskId, source)?.id, owner.id);
      await rejected(
        rewriteInput(agent.id, source, "OTHER-MEMBER-MUST-NOT-REWRITE", taskId),
        /own|member|sender|person|author|自己的|成员/i,
        other,
      );
      await rejected(
        rewriteInput(agent.id, source, "HOST-MUST-NOT-REWRITE-ANOTHER-MEMBER", taskId),
        /own|member|sender|person|author|自己的|成员/i,
        other,
        "host",
      );
      await rejected(
        rewriteInput(agent.id, source, "SIGNED-OUT-HOST-MUST-NOT-REWRITE-ANOTHER-MEMBER", taskId),
        /own|member|sender|person|author|自己的|成员/i,
        undefined,
        "host",
      );
      const receipt = await runCauseEffect(
        service().agents.rewriteMessage(rewriteInput(agent.id, source, "OWNER-REWRITE", taskId), owner),
      );
      const id = receipt.deliveries[0]?.id;
      assert.ok(id);
      await settled(id);
      await idle(agent.id, taskId);
      const anonymous = await send(agent.id, "NO-KNOWN-SENDER", taskId);
      assert.equal(
        service().database.readConversationMessages(agent.id, threadId, [anonymous])[0]?.senderMember,
        undefined,
      );
      await rejected(
        rewriteInput(agent.id, anonymous, "UNKNOWN-SENDER-MUST-NOT-REWRITE", taskId),
        /own|member|sender|person|author|自己的|成员/i,
        owner,
      );
      const localReceipt = await runCauseEffect(
        service().agents.rewriteMessage(
          rewriteInput(agent.id, anonymous, "HOST-CAN-REWRITE-OLD-QUESTION", taskId),
          owner,
          "host",
        ),
      );
      const localId = localReceipt.deliveries[0]?.id;
      assert.ok(localId);
      await settled(localId);
      await idle(agent.id, taskId);
      assert.ok(service().database.rewoundMessageIds(threadId).has(anonymous));
      assert.equal(
        service().database.readConversationMessages(agent.id, threadId, [localId])[0]?.senderMember?.id,
        owner.id,
      );
      return {
        ownerFallbackDelivery: id,
        otherMemberRejected: true,
        missingBothRejected: true,
        localLegacyRewrite: localId,
      };
    });

  await check("routine messages cannot be rewritten as user messages", async () => {
    const agent = await createAgent("Routine source");
    await send(agent.id, "ROUTINE-SOURCE-PREFIX");
    const routine = service().agents.createRoutine({
      agentId: agent.id,
      name: "Source routine",
      instruction: "ROUTINE-SOURCE",
      active: false,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    const run = await runCauseEffect(service().agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
    assert.ok(run.deliveryId);
    await settled(run.deliveryId);
    await idle(agent.id, null);
    await rejected(
      rewriteInput(agent.id, run.deliveryId, "MUST-NOT-REWRITE-ROUTINE"),
      /message|rewrite|finished|completed|user|routine|消息|重写/i,
    );
    return { routineDeliveryId: run.deliveryId };
  });
  assert.equal(process.env.HOME, originalEnvironment.HOME);
  assert.equal(process.env.CODEX_HOME, originalEnvironment.CODEX_HOME);
  assert.ok(
    !entries().some((entry) => entry.method === "unsupported"),
    "Fake received an unsupported protocol request.",
  );
  assert.deepEqual(report.serviceFailures, [], "AgentService emitted errors or backfill failures.");
  report.passed = report.checks.length === 9 && report.checks.every((result) => result.passed);
} catch (error) {
  report.error = errorText(error);
} finally {
  control();
  try {
    await stop();
  } catch (error) {
    report.cleanupError = errorText(error);
    report.passed = false;
  }
  report.protocol = entries();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (originalEnvironment.OPENBOT_CODEX_PATH === undefined) delete process.env.OPENBOT_CODEX_PATH;
  else process.env.OPENBOT_CODEX_PATH = originalEnvironment.OPENBOT_CODEX_PATH;
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"}: ${report.checks.filter((result) => result.passed).length}/${report.checks.length} checks. Report: ${join(OUT, "report.json")}\n`,
  );
  if (report.error) process.stderr.write(`${report.error}\n`);
  if (!report.passed) process.exitCode = 1;
}
