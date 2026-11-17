// Real AgentService, DrainScheduler and Codex JSON-RPC transport, with a local fake CLI process.
// No provider account or network is used. Fifty sessions share that fake process; this is not a
// measurement of fifty real model requests. Run: bun scripts/server-work-service-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentTask, BusyMessageMode, CustomMessageMode } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord as record } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { isServerWorkReceipt, SERVER_WORK_RECEIPT_ITEM_TYPE } from "../src/backend/agent/server-work-receipt";
import type { ServerWorkRouteDecisionInput } from "../src/backend/agent/server-work-routing";
import { type ToolOperationFailed, toToolOperationFailed } from "../src/backend/agent/tool-operation";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import {
  CUSTOM_MESSAGE_ROUTING_FILE,
  CustomMessageRoutingPreferenceStore,
} from "../src/main/custom-message-routing-preference-store";
import { HostTurnLimitsPreferenceStore } from "../src/main/host-turn-limits-preference-store";

const projectRoot = process.env.OPENBOT_WORK_SERVICE_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "server-work-service-e2e");
const report: { passed: boolean; checks: string[]; fakeSessions?: number; routingAdapter?: string; error?: string } = {
  passed: false,
  checks: [],
};

// Plain CommonJS, so the Windows .cmd shim can run it with the fixture's Node executable.
const FAKE_CODEX = String.raw`
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.167.2\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_WORK_SERVICE_LOG, JSON.stringify(entry) + "\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const active = new Map();
const pending = new Map();
let nextThread = 0;
let nextTurn = 0;
let consumed = 0;
function finish(threadId, text, status = "completed") {
  const turnId = active.get(threadId);
  if (!turnId) return;
  active.delete(threadId);
  if (text) write({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "answer-" + turnId, text, phase: "final_answer" } } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status, ...(status === "failed" ? { error: { message: "Controlled failure." } } : {}) } } });
  log({ event: "finished", threadId, turnId, status, text: text || "" });
}
function answer(message) {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "fixture@example.invalid" }, requiresOpenaiAuth: false } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", isDefault: true }], nextCursor: null } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/name/set": return write({ id: message.id, result: {} });
    case "thread/start":
    case "thread/resume": {
      const threadId = message.method === "thread/start" ? "fake-" + process.pid + "-thread-" + (++nextThread) : params.threadId;
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const threadId = params.threadId;
      if (active.has(threadId)) return write({ id: message.id, error: { code: -32000, message: "Thread already has an active turn." } });
      const turnId = "fake-" + process.pid + "-turn-" + (++nextTurn);
      active.set(threadId, turnId);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      log({ event: "started", threadId, turnId, input: JSON.stringify(params.input) });
      return;
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      finish(params.threadId, "", "interrupted");
      return;
    }
    case "turn/steer": {
      log({ event: "steered", threadId: params.threadId, turnId: active.get(params.threadId), deliveryId: params.clientUserMessageId });
      return write({ id: message.id, result: { turnId: active.get(params.threadId) } });
    }
    default: return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const end = buffer.indexOf("\n");
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method && message.id !== undefined) answer(message);
    else if (pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      log({ event: "toolResult", id: message.id, message });
      write({ method: "item/completed", params: { threadId: call.threadId, turnId: call.turnId, item: { type: "dynamicToolCall", id: call.id, callId: call.id, namespace: "openbot", tool: call.tool, arguments: call.arguments, status: message.error ? "failed" : "completed", result: message.result } } });
    }
  }
});
const timer = setInterval(() => {
  const content = fs.readFileSync(process.env.OPENBOT_WORK_SERVICE_CONTROL, "utf8");
  const lines = content.split("\n");
  while (consumed < lines.length - 1) {
    const command = JSON.parse(lines[consumed++]);
    if (!active.has(command.threadId)) continue;
    if (command.kind === "finish") finish(command.threadId, command.text, command.status);
    else if (command.kind === "tool" && active.get(command.threadId) === command.turnId) {
      pending.set(command.id, command);
      write({ method: "item/started", params: { threadId: command.threadId, turnId: command.turnId, item: { type: "dynamicToolCall", id: command.id, callId: command.id, namespace: "openbot", tool: command.tool, arguments: command.arguments, status: "inProgress" } } });
      write({ id: command.id, method: "item/tool/call", params: { threadId: command.threadId, turnId: command.turnId, callId: command.id, namespace: "openbot", tool: command.tool, arguments: command.arguments } });
    }
  }
}, 10);
process.stdin.on("end", () => { clearInterval(timer); process.exit(0); });
process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); else throw error; });
`;

type FixtureCommand =
  | { kind: "tool"; id: string; threadId: string; turnId: string; tool: string; arguments: DynamicRecord }
  | { kind: "finish"; threadId: string; text?: string };

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const profile = join(root, "profile");
  const logPath = join(root, "protocol.jsonl");
  const controlPath = join(root, "control.jsonl");
  const fakeScript = join(root, "fake-codex.cjs");
  const fakeCli = process.platform === "win32" ? join(root, "codex.cmd") : join(root, "codex");
  writeFileSync(logPath, "");
  writeFileSync(controlPath, "");
  writeFileSync(fakeScript, FAKE_CODEX);
  if (process.platform === "win32") {
    writeFileSync(fakeCli, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`);
  } else writeFileSync(fakeCli, `#!/usr/bin/env node\n${FAKE_CODEX}`, { mode: 0o755 });
  // Existing CLI override only. The user's HOME, CODEX_HOME and account files are not changed.
  process.env.OPENBOT_CODEX_PATH = fakeCli;
  process.env.OPENBOT_WORK_SERVICE_LOG = logPath;
  process.env.OPENBOT_WORK_SERVICE_CONTROL = controlPath;

  const { AGENT_PROVIDERS } = await import("@openbot/contracts/ipc");
  const { AgentService } = await import("../src/backend/agent-service");
  const { AgentStore } = await import("../src/backend/agent-store");
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const { MailboxStore, MESSAGING_LANE } = await import("../src/backend/mailbox-store");
  const { OpenBotDatabase } = await import("../src/backend/openbot-database");
  const { defaultServerWorkPolicy, serverWorkPolicyForAgent } = await import("./server-work-fixture-policy");
  const policy = defaultServerWorkPolicy();
  const unused = () => Effect.die(new Error("Browser use is outside this fixture."));
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
    shareTab: () => undefined,
    unshareThread: () => undefined,
    agentTab: () => null,
  };
  const database = new OpenBotDatabase(profile);
  const store = new AgentStore(profile, join(root, "home"), database);
  const mailbox = new MailboxStore(profile, store.sharedRoot, database);
  const routingModes = new Map<string, CustomMessageMode>();
  let routingDefault: CustomMessageMode = "queue";
  const mainDispatchAgents = new Set<string>();
  const routingInputs: ServerWorkRouteDecisionInput[] = [];
  let routingDecision: unknown = { kind: "new", title: "Injected route fixture" };
  let duringRouting: (() => Effect.Effect<void, ToolOperationFailed>) | null = null;
  let routingPause: ((input: ServerWorkRouteDecisionInput) => Effect.Effect<void, ToolOperationFailed>) | null = null;
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    busyMessageMode: () => "queue",
    serverWorkPolicy: {
      policy: (id) => {
        const configured = serverWorkPolicyForAgent(policy, id);
        return configured
          ? { ...configured, dispatchMode: mainDispatchAgents.has(id) ? "main" : configured.dispatchMode }
          : null;
      },
    },
    hostTurnLimits: { turnLimit: () => 64, agentTaskLimit: () => 50 },
    memoryReviewInterval: () => 0,
    messageRouting: {
      mode: (agentId) => routingModes.get(agentId) ?? routingDefault,
      decide: (input) =>
        Effect.gen(function* () {
          routingInputs.push(structuredClone(input));
          const change = duringRouting;
          duringRouting = null;
          if (change) yield* change();
          const pause = routingPause;
          if (pause) yield* pause(input);
          return routingDecision;
        }),
    },
  });
  const errors: string[] = [];
  agents.on("event", (event) => {
    if (event.type === "error") errors.push(`${event.code}: ${event.message}`);
  });
  const log = () =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line))
      .filter(record);
  const command = (value: FixtureCommand) => appendFileSync(controlPath, `${JSON.stringify(value)}\n`);
  async function waitFor<T>(label: string, read: () => T | false | null | undefined, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}. ${errors.join("; ")}`);
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  async function startedFor(turnId: string) {
    const entry = await waitFor("fake provider turn", () =>
      log().find((item) => item.event === "started" && item.turnId === turnId),
    );
    assert.equal(typeof entry.threadId, "string");
    assert.equal(typeof entry.turnId, "string");
    return { threadId: String(entry.threadId), turnId: String(entry.turnId) };
  }
  async function runningTask(agentId: string, taskId: string) {
    const task = await waitFor(`task ${taskId} to run`, () =>
      agents
        .listTasks(agentId)
        .tasks.find((item) => item.id === taskId && item.state === "running" && item.activeTurnId),
    );
    assert.ok(task.activeTurnId);
    return { task, ...(await startedFor(task.activeTurnId)) };
  }
  let nextCall = 0;
  async function tool(
    session: { threadId: string; turnId: string },
    name: string,
    args: DynamicRecord,
    success = true,
  ) {
    const id = `fixture-call-${++nextCall}`;
    command({ kind: "tool", id, ...session, tool: name, arguments: args });
    const response = await waitFor(`tool ${name}`, () =>
      log().find((entry) => entry.event === "toolResult" && entry.id === id),
    );
    assert.ok(record(response.message));
    if (!success) {
      assert.ok(
        response.message.error || (record(response.message.result) && response.message.result.success === false),
      );
      return {};
    }
    assert.equal(response.message.error, undefined, JSON.stringify(response.message));
    const result = response.message.result;
    assert.ok(record(result));
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(Array.isArray(result.contentItems));
    const content = result.contentItems.find((item: unknown) => record(item) && item.type === "inputText");
    assert.ok(record(content) && typeof content.text === "string");
    const parsed = JSON.parse(content.text);
    assert.ok(record(parsed));
    return parsed;
  }
  function firstWork(result: DynamicRecord) {
    assert.ok(Array.isArray(result.work));
    const work = result.work[0];
    assert.ok(record(work) && typeof work.taskId === "string" && typeof work.messageId === "string");
    return { taskId: work.taskId, messageId: work.messageId };
  }
  async function create(name: string) {
    return runCauseEffect(
      agents.createAgent({
        name,
        description: "Local fake provider fixture.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: `SERVICE_${name.toUpperCase()}_MAIN_HOLD`,
      }),
    );
  }

  try {
    await runCauseEffect(agents.initialize());
    const preferenceRoot = join(root, "preference-fixture");
    mkdirSync(preferenceRoot, { recursive: true });
    const routingPath = join(preferenceRoot, CUSTOM_MESSAGE_ROUTING_FILE);
    const limitsPath = join(preferenceRoot, "host-turn-limits-v1.json");
    const preferenceA = await runCauseEffect(
      store.createAgent({
        name: "Preference A",
        description: "Preference fixture",
        avatarSeed: "preference-a",
        avatarHue: null,
      }),
    );
    const preferenceB = await runCauseEffect(
      store.createAgent({
        name: "Preference B",
        description: "Preference fixture",
        avatarSeed: "preference-b",
        avatarHue: null,
      }),
    );
    await runCauseEffect(store.updateAgent({ agentId: preferenceA.id, busyMessageMode: "queue" }));
    let legacyDefault: BusyMessageMode = "steer";
    const preferenceOptions = { path: routingPath, legacyDefault: () => legacyDefault, agents: () => store.list() };
    const routingPreferences = new CustomMessageRoutingPreferenceStore(preferenceOptions);
    const hostLimits = new HostTurnLimitsPreferenceStore(limitsPath, () => null);
    await runCauseEffect(hostLimits.load());
    await runCauseEffect(hostLimits.set({ turnLimit: 128, agentTaskLimit: 64 }));
    const originalLimitsFile = readFileSync(limitsPath);
    assert.equal(existsSync(routingPath), false);
    await runCauseEffect(routingPreferences.load());
    assert.equal(routingPreferences.mode(preferenceA.id), "queue");
    assert.equal(routingPreferences.mode(preferenceB.id), "steer");
    assert.equal(routingPreferences.get().defaultMode, "steer");
    assert.equal(existsSync(routingPath), false, "Loading absent routing preferences never opts the host into Thread.");
    report.checks.push("Missing routing preferences follow released Queue/Steer choices without enabling Thread.");

    await runCauseEffect(routingPreferences.set({ mode: "thread" }));
    await runCauseEffect(routingPreferences.set({ agentIds: [preferenceB.id], mode: "queue" }));
    assert.equal(routingPreferences.mode(preferenceB.id), "queue");
    await runCauseEffect(routingPreferences.set({ agentIds: [preferenceA.id], mode: null }));
    assert.equal(
      routingPreferences.mode(preferenceA.id),
      "thread",
      "An explicit default clears the legacy per-agent Queue choice.",
    );
    await runCauseEffect(routingPreferences.set({ agentIds: [preferenceB.id], mode: null }));
    const reloadedPreferences = new CustomMessageRoutingPreferenceStore(preferenceOptions);
    await runCauseEffect(reloadedPreferences.load());
    assert.equal(reloadedPreferences.get().defaultMode, "thread");
    assert.equal(reloadedPreferences.mode(preferenceA.id), "thread");
    assert.equal(reloadedPreferences.mode(preferenceB.id), "thread");
    const beforeInvalid = readFileSync(routingPath);
    await assert.rejects(
      runCauseEffect(
        reloadedPreferences.set({ agentIds: [preferenceA.id, "unknown-preference-agent"], mode: "queue" }),
      ),
    );
    assert.deepEqual(readFileSync(routingPath), beforeInvalid);
    assert.equal(reloadedPreferences.mode(preferenceA.id), "thread");
    report.checks.push(
      "Global Thread, per-agent Queue and explicit default survive reload; an unknown-agent batch changes neither memory nor the preference file.",
    );

    await runCauseEffect(reloadedPreferences.set({ agentIds: [preferenceA.id], mode: "thread" }));
    await runCauseEffect(store.updateAgent({ agentId: preferenceA.id, busyMessageMode: "steer" }));
    await runCauseEffect(reloadedPreferences.followLegacyAgent(preferenceA.id));
    assert.equal(reloadedPreferences.mode(preferenceA.id), "steer");
    legacyDefault = "queue";
    await runCauseEffect(reloadedPreferences.followLegacyDefault());
    assert.equal(reloadedPreferences.get().defaultMode, "queue");
    assert.equal(reloadedPreferences.mode(preferenceB.id), "queue");
    await Promise.all([
      runCauseEffect(reloadedPreferences.set({ agentIds: [preferenceA.id], mode: "thread" })),
      runCauseEffect(reloadedPreferences.set({ agentIds: [preferenceB.id], mode: "steer" })),
    ]);
    const afterConcurrent = new CustomMessageRoutingPreferenceStore(preferenceOptions);
    await runCauseEffect(afterConcurrent.load());
    assert.equal(afterConcurrent.mode(preferenceA.id), "thread");
    assert.equal(afterConcurrent.mode(preferenceB.id), "steer");
    assert.deepEqual(
      readFileSync(limitsPath),
      originalLimitsFile,
      "Routing changes never write the official host limits file.",
    );
    const reloadedLimits = new HostTurnLimitsPreferenceStore(limitsPath, () => null);
    await runCauseEffect(reloadedLimits.load());
    assert.equal(reloadedLimits.turnLimit(), 128);
    assert.equal(reloadedLimits.agentTaskLimit(), 64);
    report.checks.push(
      "Released editors restore legacy choices; concurrent routing writes preserve both agents; official host limits remain 128/64 byte for byte.",
    );

    const incoming = await create("Incoming");
    const main = await waitFor("incoming agent main turn", () =>
      mailbox
        .unresolvedDeliveries()
        .find(
          ({ delivery }) =>
            delivery.recipientAgentId === incoming.id &&
            delivery.status === "running" &&
            delivery.turnId &&
            mailbox.taskIdForDelivery(delivery.id) === null,
        ),
    );
    assert.ok(main.delivery.turnId);
    const mainSession = await startedFor(main.delivery.turnId);
    const mainTurnId = main.delivery.turnId;
    routingModes.set(incoming.id, "thread");
    const decisionStart = routingInputs.length;
    const newInput = { agentId: incoming.id, text: "SERVICE_ROUTED_USER_NEW", clientMessageId: "routed-user-new" };
    const routed = await runCauseEffect(agents.sendMessage(newInput));
    const routedDelivery = routed.deliveries[0];
    assert.ok(routedDelivery);
    const routedTaskId = mailbox.taskIdForDelivery(routedDelivery.id);
    assert.ok(routedTaskId);
    const realCursorBeforeReceipt =
      agents.listConversationReads("fixture-receipt-reader")[incoming.id]?.throughMessageId ?? null;
    const readImmediately = await runCauseEffect(
      agents.markConversationRead(incoming.id, "fixture-receipt-reader", routedDelivery.id),
    );
    assert.equal(
      readImmediately.throughMessageId,
      realCursorBeforeReceipt,
      "A virtual acknowledgement safely leaves the durable main read cursor unchanged.",
    );
    const routedSession = await runningTask(incoming.id, routedTaskId);
    assert.notEqual(routedSession.threadId, mainSession.threadId);
    assert.equal(mailbox.getDelivery(main.delivery.id)?.delivery.turnId, mainTurnId);
    assert.equal(mailbox.getDelivery(main.delivery.id)?.delivery.status, "running");
    assert.equal(routingInputs.length, decisionStart + 1);
    const retried = await runCauseEffect(agents.sendMessage(newInput));
    assert.equal(retried.messageId, routed.messageId);
    assert.equal(routingInputs.length, decisionStart + 1);
    assert.equal(agents.listTasks(incoming.id).tasks.length, 1);
    const mainSnapshot = await runCauseEffect(agents.readConversation(incoming.id));
    const sideSnapshot = agents.readTask(incoming.id, routedTaskId);
    const acknowledgements = mainSnapshot.messages.filter((message) => message.id === routedDelivery.id);
    assert.equal(acknowledgements.length, 1);
    const acknowledgement = acknowledgements[0];
    assert.ok(acknowledgement && isServerWorkReceipt(acknowledgement));
    assert.equal(acknowledgement.attachments, undefined);
    assert.equal(acknowledgement.text.includes(newInput.text), false);
    assert.equal(
      mainSnapshot.messages.filter((message) => message.author === "user" && message.text === newInput.text).length,
      0,
    );
    assert.equal(
      sideSnapshot.messages.filter((message) => message.author === "user" && message.text === newInput.text).length,
      1,
    );
    const childRequestBeforeReaction = sideSnapshot.messages.find((message) => message.id === routedDelivery.id);
    assert.ok(childRequestBeforeReaction);
    const childReactionBefore = mailbox.reactionFor(incoming.id, routedDelivery.id);
    const receiptReaction = await Effect.runPromise(
      Effect.result(
        agents.setMessageReaction({
          agentId: incoming.id,
          messageId: routedDelivery.id,
          emoji: "👍",
        }),
      ),
    );
    assert.ok(Result.isFailure(receiptReaction), "A main acknowledgement cannot change the child request's reaction.");
    assert.equal(receiptReaction.failure._tag, "AgentLifecycleFailed");
    assert.equal(mailbox.reactionFor(incoming.id, routedDelivery.id), childReactionBefore);
    assert.deepEqual(
      agents.readTask(incoming.id, routedTaskId).messages.find((message) => message.id === routedDelivery.id),
      childRequestBeforeReaction,
    );
    assert.ok(mainSnapshot.threadId);
    const reloadedMain = database.readConversation(incoming.id, mainSnapshot.threadId);
    assert.equal(
      reloadedMain.messages.some((message) => message.id === routedDelivery.id),
      false,
      "Virtual acknowledgements never become durable main conversation rows.",
    );
    const reloadedMailbox = new MailboxStore(profile, store.sharedRoot, database);
    await runCauseEffect(reloadedMailbox.initialize());
    const reloadedNotice = reloadedMailbox.workReceipt(incoming.id, mainSnapshot.threadId, routedDelivery.id);
    assert.ok(
      reloadedNotice && isServerWorkReceipt(reloadedNotice),
      "Mailbox metadata reconstructs the virtual receipt after reload.",
    );
    assert.ok(
      (await runCauseEffect(agents.readConversation(incoming.id))).messages.some(
        (message) => message.id === routedDelivery.id && isServerWorkReceipt(message),
      ),
    );
    assert.equal(
      database.connection
        .prepare("SELECT COUNT(*) AS total FROM projection_thread_messages WHERE item_type=?")
        .get(SERVER_WORK_RECEIPT_ITEM_TYPE)?.total,
      0,
    );
    assert.equal(
      database.connection
        .prepare("SELECT COUNT(*) AS total FROM orchestration_events WHERE payload_json LIKE ?")
        .get(`%${SERVER_WORK_RECEIPT_ITEM_TYPE}%`)?.total,
      0,
      "No replayable event stores a synthetic receipt message.",
    );
    writeFileSync(
      join(output, "routed-user-receipt.json"),
      `${JSON.stringify({ mainSnapshot, receipt: routed, sideSnapshot }, null, 2)}\n`,
    );
    report.checks.push(
      "Thread mode routes a new user request beside a busy main turn; clientMessageId retry makes no second decision, message or task.",
    );
    report.checks.push(
      "The API exposes one virtual acknowledgement; marking it read preserves the real main cursor, and reaction refusal preserves its child request. Original text stays in its side chat, mailbox reload reconstructs the notice, and no raw main row or replay event stores it.",
    );

    routingDecision = { kind: "existing", taskId: routedTaskId };
    const related = await runCauseEffect(
      agents.sendMessage({ agentId: incoming.id, text: "SERVICE_ROUTED_RELATED", clientMessageId: "routed-related" }),
    );
    const relatedDelivery = related.deliveries[0];
    assert.ok(relatedDelivery);
    assert.equal(mailbox.taskIdForDelivery(relatedDelivery.id), routedTaskId);
    assert.equal(agents.listTasks(incoming.id).tasks.length, 1);
    assert.ok(mailbox.taskQueue(incoming.id, routedTaskId).some((delivery) => delivery.id === relatedDelivery.id));
    assert.ok(routingInputs.at(-1)?.candidates.some((candidate) => candidate.taskId === routedTaskId));
    const explicitStart = routingInputs.length;
    const explicit = await runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        taskId: routedTaskId,
        text: "SERVICE_EXPLICIT_TASK",
        clientMessageId: "explicit-task",
      }),
    );
    assert.equal(mailbox.taskIdForDelivery(explicit.deliveries[0]?.id ?? ""), routedTaskId);
    const reply = await runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_EXPLICIT_MAIN_REPLY",
        replyToMessageId: main.delivery.messageId,
        clientMessageId: "explicit-main-reply",
      }),
    );
    assert.equal(mailbox.taskIdForDelivery(reply.deliveries[0]?.id ?? ""), null);
    assert.equal(routingInputs.length, explicitStart);
    const ackReply = await runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_REPLY_TO_HOST_ACK",
        replyToMessageId: routedDelivery.id,
        clientMessageId: "reply-host-ack",
      }),
    );
    assert.equal(mailbox.taskIdForDelivery(ackReply.deliveries[0]?.id ?? ""), routedTaskId);
    assert.equal(
      routingInputs.length,
      explicitStart,
      "An explicit reply to a host acknowledgement maps directly to the original task.",
    );
    report.checks.push(
      "An injected related-work decision reuses its managed chat; explicit task and reply routes bypass classification.",
    );

    const legacyStart = routingInputs.length;
    await runCauseEffect(store.updateAgent({ agentId: incoming.id, busyMessageMode: "steer" }));
    const legacy = await runCauseEffect(
      agents.sendMessage(
        { agentId: incoming.id, text: "SERVICE_LEGACY_CLIENT", clientMessageId: "legacy-client" },
        undefined,
        undefined,
        { allowAutomaticThread: false },
      ),
    );
    const legacyDeliveryId = legacy.deliveries[0]?.id;
    assert.ok(legacyDeliveryId);
    assert.equal(mailbox.taskIdForDelivery(legacyDeliveryId), null);
    await waitFor("legacy client retains released native steer", () =>
      log().find((entry) => entry.event === "steered" && entry.deliveryId === legacyDeliveryId),
    );
    await waitFor(
      "legacy steer uses original main turn",
      () => mailbox.getDelivery(legacyDeliveryId)?.delivery.status === "running",
    );
    assert.equal(mailbox.getDelivery(legacyDeliveryId)?.delivery.turnId, mainTurnId);
    assert.equal(routingInputs.length, legacyStart);
    await runCauseEffect(store.updateAgent({ agentId: incoming.id, busyMessageMode: "queue" }));
    routingDecision = { kind: "unknown", taskId: routedTaskId };
    const invalid = await runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_INVALID_ROUTER_FALLBACK",
        clientMessageId: "invalid-route",
      }),
    );
    const invalidDelivery = invalid.deliveries[0];
    assert.ok(invalidDelivery);
    assert.equal(mailbox.taskIdForDelivery(invalidDelivery.id), null);
    assert.equal(mailbox.getDelivery(invalidDelivery.id)?.delivery.text, "SERVICE_INVALID_ROUTER_FALLBACK");
    assert.equal(mailbox.getDelivery(invalidDelivery.id)?.delivery.status, "queued");
    report.checks.push(
      "Legacy origins suppress automatic Thread routing; an invalid decision retains the original user request in the main queue.",
    );

    routingDecision = { kind: "new", title: "Stale route fixture" };
    const stale = await runCauseEffect(
      agents.sendMessage({ agentId: incoming.id, text: "SERVICE_STALE_TASK_HOLD", clientMessageId: "stale-task" }),
    );
    const staleTaskId = mailbox.taskIdForDelivery(stale.deliveries[0]?.id ?? "");
    assert.ok(staleTaskId);
    const staleSession = await runningTask(incoming.id, staleTaskId);
    command({ kind: "finish", threadId: staleSession.threadId, text: "SERVICE_STALE_TASK_DONE" });
    await waitFor("stale fixture task finishes", () =>
      agents
        .listTasks(incoming.id)
        .tasks.find(
          (task) =>
            task.id === staleTaskId &&
            task.outcome === "completed" &&
            !task.activeTurnId &&
            !mailbox.taskBusy(incoming.id, task.id),
        ),
    );
    routingDecision = { kind: "existing", taskId: staleTaskId };
    duringRouting = () => agents.closeTask({ agentId: incoming.id, taskId: staleTaskId }).pipe(toToolOperationFailed);
    const staleFallback = await runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_STALE_ROUTER_FALLBACK",
        clientMessageId: "stale-fallback",
      }),
    );
    const staleFallbackId = staleFallback.deliveries[0]?.id;
    assert.ok(staleFallbackId);
    assert.equal(mailbox.taskIdForDelivery(staleFallbackId), null);
    assert.equal(mailbox.getDelivery(staleFallbackId)?.delivery.text, "SERVICE_STALE_ROUTER_FALLBACK");
    assert.equal(mailbox.getDelivery(staleFallbackId)?.delivery.status, "queued");
    report.checks.push(
      "A managed task closed during the injected decision is refused and its incoming request remains in the main queue.",
    );

    routingDecision = { kind: "new", title: "Attachment route fixture" };
    const attachmentPath = join(root, "routed-attachment.txt");
    writeFileSync(attachmentPath, "SERVICE_ROUTED_ATTACHMENT_CONTENT");
    const drafts = await runCauseEffect(agents.prepareAttachments([attachmentPath]));
    assert.equal(drafts.length, 1);
    const member = { id: "fixture-local-member", name: "Fixture member" };
    const withAttachment = await runCauseEffect(
      agents.sendMessage(
        {
          agentId: incoming.id,
          text: "SERVICE_ROUTED_ATTACHMENT",
          clientMessageId: "routed-attachment",
          attachmentDraftIds: drafts.map((draft) => draft.id),
        },
        member,
        "America/Sao_Paulo",
      ),
    );
    const attachedDeliveryId = withAttachment.deliveries[0]?.id;
    assert.ok(attachedDeliveryId);
    const attachedTaskId = mailbox.taskIdForDelivery(attachedDeliveryId);
    assert.ok(attachedTaskId);
    await runningTask(incoming.id, attachedTaskId);
    const attached = mailbox.getDelivery(attachedDeliveryId);
    assert.equal(attached?.managedAttachments.length, 1);
    assert.ok(attached?.managedAttachments[0]);
    assert.equal(readFileSync(attached.managedAttachments[0].path, "utf8"), "SERVICE_ROUTED_ATTACHMENT_CONTENT");
    const persisted = database.readMailboxState();
    assert.ok(record(persisted) && Array.isArray(persisted.messages));
    const message = persisted.messages.find((value: unknown) => record(value) && value.id === withAttachment.messageId);
    assert.ok(record(message));
    assert.deepEqual(message.senderMember, member);
    report.checks.push("Automatic user Thread routing keeps the original attachment and host-stamped member identity.");

    routingDecision = { kind: "new", title: "Concurrent route fixture" };
    const firstDeciderEntered = Promise.withResolvers<void>();
    const bothDecidersEntered = Promise.withResolvers<void>();
    const releaseDeciders = Promise.withResolvers<void>();
    let enteredDeciders = 0;
    routingPause = () =>
      Effect.promise(async () => {
        enteredDeciders++;
        if (enteredDeciders === 1) firstDeciderEntered.resolve();
        if (enteredDeciders === 2) bothDecidersEntered.resolve();
        await releaseDeciders.promise;
      });
    const concurrentFirst = runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_CONCURRENT_ROUTING_FIRST",
        clientMessageId: "concurrent-route-first",
      }),
    );
    await firstDeciderEntered.promise;
    const concurrentSecond = runCauseEffect(
      agents.sendMessage({
        agentId: incoming.id,
        text: "SERVICE_CONCURRENT_ROUTING_SECOND",
        clientMessageId: "concurrent-route-second",
      }),
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        bothDecidersEntered.promise,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error("The second route decider waited behind the first request's admission lock.")),
            5_000,
          );
        }),
      ]);
      assert.equal(enteredDeciders, 2, "Both deciders enter before either decision is released.");
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      routingPause = null;
      releaseDeciders.resolve();
    }
    const concurrentReceipts = await Promise.all([concurrentFirst, concurrentSecond]);
    const concurrentTaskIds = concurrentReceipts.map((receipt) =>
      mailbox.taskIdForDelivery(receipt.deliveries[0]?.id ?? ""),
    );
    assert.ok(concurrentTaskIds[0] && concurrentTaskIds[1]);
    assert.notEqual(concurrentTaskIds[0], concurrentTaskIds[1]);
    const firstConcurrentSession = await runningTask(incoming.id, concurrentTaskIds[0]);
    const secondConcurrentSession = await runningTask(incoming.id, concurrentTaskIds[1]);
    assert.notEqual(firstConcurrentSession.threadId, secondConcurrentSession.threadId);
    assert.equal(mailbox.getDelivery(main.delivery.id)?.delivery.turnId, mainTurnId);
    assert.equal(mailbox.getDelivery(main.delivery.id)?.delivery.status, "running");
    report.checks.push(
      "Two incoming user requests reach their injected deciders before either is released, then start separate work sessions while the original main turn stays busy.",
    );

    const failedAttachmentPath = join(root, "receipt-failure-attachment.txt");
    writeFileSync(failedAttachmentPath, "SERVICE_RECEIPT_ATOMIC_ATTACHMENT");
    const failedDrafts = await runCauseEffect(agents.prepareAttachments([failedAttachmentPath]));
    const failedDraft = failedDrafts[0];
    assert.ok(failedDraft);
    const beforeFailedMailbox = database.readMailboxState();
    const beforeFailedTasks = agents
      .listTasks(incoming.id)
      .tasks.map((task) => task.id)
      .sort();
    const countAcknowledgements = () =>
      database.connection
        .prepare("SELECT COUNT(*) AS total FROM orchestration_events WHERE event_type='server-work.receipt'")
        .get()?.total;
    const beforeFailedAcknowledgements = countAcknowledgements();
    assert.equal(typeof beforeFailedAcknowledgements, "number");
    const atomicInput = {
      agentId: incoming.id,
      text: "SERVICE_RECEIPT_ATOMIC_FAILURE",
      clientMessageId: "receipt-atomic-failure",
      attachmentDraftIds: [failedDraft.id],
    };
    routingDecision = { kind: "new", title: "Atomic acknowledgement fixture" };
    database.connection.exec(`CREATE TEMP TRIGGER fail_host_route_receipt BEFORE INSERT ON orchestration_events
      WHEN NEW.event_type='server-work.receipt'
      BEGIN SELECT RAISE(ABORT, 'Injected virtual receipt transaction failure.'); END`);
    try {
      await assert.rejects(runCauseEffect(agents.sendMessage(atomicInput)));
    } finally {
      database.connection.exec("DROP TRIGGER IF EXISTS fail_host_route_receipt");
    }
    assert.deepEqual(
      database.readMailboxState(),
      beforeFailedMailbox,
      "An acknowledgement failure rolls back its mailbox message and delivery.",
    );
    assert.equal(countAcknowledgements(), beforeFailedAcknowledgements);
    assert.deepEqual(
      agents
        .listTasks(incoming.id)
        .tasks.map((task) => task.id)
        .sort(),
      beforeFailedTasks,
      "The failed send discards only its newly created empty work thread.",
    );
    assert.equal(mailbox.draftName(failedDraft.id), failedDraft.name);
    assert.equal(
      (await runCauseEffect(agents.readConversation(incoming.id))).messages.some((message) =>
        message.text.includes(atomicInput.text),
      ),
      false,
    );
    const recoveredAtomic = await runCauseEffect(agents.sendMessage(atomicInput));
    const recoveredAtomicId = recoveredAtomic.deliveries[0]?.id;
    assert.ok(recoveredAtomicId);
    const recoveredAtomicTaskId = mailbox.taskIdForDelivery(recoveredAtomicId);
    assert.ok(recoveredAtomicTaskId);
    await runningTask(incoming.id, recoveredAtomicTaskId);
    assert.equal(mailbox.draftName(failedDraft.id), null, "The original draft remains usable for a successful retry.");
    const recoveredAttachment = mailbox.getDelivery(recoveredAtomicId)?.managedAttachments[0];
    assert.ok(recoveredAttachment);
    assert.equal(readFileSync(recoveredAttachment.path, "utf8"), "SERVICE_RECEIPT_ATOMIC_ATTACHMENT");
    assert.ok(
      (await runCauseEffect(agents.readConversation(incoming.id))).messages.some(
        (message) => message.id === recoveredAtomicId && isServerWorkReceipt(message),
      ),
    );
    assert.equal(
      database.connection
        .prepare("SELECT COUNT(*) AS total FROM projection_thread_messages WHERE item_type=?")
        .get(SERVER_WORK_RECEIPT_ITEM_TYPE)?.total,
      0,
    );
    assert.equal(
      database.connection
        .prepare("SELECT COUNT(*) AS total FROM orchestration_events WHERE payload_json LIKE ?")
        .get(`%${SERVER_WORK_RECEIPT_ITEM_TYPE}%`)?.total,
      0,
    );
    report.checks.push(
      "A real SQLite revision-event failure atomically rolls back mailbox receipt metadata and work, retains the original draft and discards its empty task; retry restores a virtual notice without any stored notice row or replay payload.",
    );

    const unchangedDecisions = routingInputs.length;
    routingModes.set(incoming.id, "queue");
    const queued = await runCauseEffect(
      agents.sendMessage({ agentId: incoming.id, text: "SERVICE_QUEUE_MODE", clientMessageId: "queue-mode" }),
    );
    const queuedId = queued.deliveries[0]?.id;
    assert.ok(queuedId);
    assert.equal(mailbox.getDelivery(queuedId)?.delivery.status, "queued");
    assert.equal(mailbox.taskIdForDelivery(queuedId), null);
    routingModes.set(incoming.id, "steer");
    const steered = await runCauseEffect(
      agents.sendMessage({ agentId: incoming.id, text: "SERVICE_STEER_MODE", clientMessageId: "steer-mode" }),
    );
    const steeredId = steered.deliveries[0]?.id;
    assert.ok(steeredId);
    await waitFor("existing native steer request", () =>
      log().find((entry) => entry.event === "steered" && entry.deliveryId === steeredId),
    );
    await waitFor(
      "steered delivery joins the original main turn",
      () => mailbox.getDelivery(steeredId)?.delivery.status === "running",
    );
    assert.equal(mailbox.getDelivery(steeredId)?.delivery.turnId, mainTurnId);
    assert.equal(mailbox.taskIdForDelivery(steeredId), null);
    assert.equal(routingInputs.length, unchangedDecisions);
    routingModes.set(incoming.id, "queue");
    report.routingAdapter = "injected-decider-no-JEV-provider";
    report.checks.push(
      "Queue keeps the request queued and Steer uses the existing provider turn; neither calls the classifier. JEV provider integration is not configured or verified by this fixture.",
    );

    const cleanupAgent = await create("ReceiptCleanup");
    const cleanupMain = await waitFor("cleanup main turn", () =>
      mailbox
        .unresolvedDeliveries()
        .find(
          ({ delivery }) =>
            delivery.recipientAgentId === cleanupAgent.id &&
            delivery.status === "running" &&
            delivery.turnId &&
            mailbox.taskIdForDelivery(delivery.id) === null,
        ),
    );
    assert.ok(cleanupMain.delivery.turnId);
    const cleanupMainSession = await startedFor(cleanupMain.delivery.turnId);
    routingModes.set(cleanupAgent.id, "thread");
    routingDecision = { kind: "new", title: "Child survives main history cleanup" };
    const cleanupChild = await runCauseEffect(
      agents.sendMessage({
        agentId: cleanupAgent.id,
        text: "SERVICE_CHILD_SURVIVES_MAIN_HISTORY_DELETE",
        clientMessageId: "cleanup-child",
      }),
    );
    const cleanupChildId = cleanupChild.deliveries[0]?.id;
    assert.ok(cleanupChildId);
    const cleanupChildTaskId = mailbox.taskIdForDelivery(cleanupChildId);
    assert.ok(cleanupChildTaskId);
    const cleanupChildSession = await runningTask(cleanupAgent.id, cleanupChildTaskId);
    command({ kind: "finish", threadId: cleanupMainSession.threadId, text: "SERVICE_CLEANUP_MAIN_DONE" });
    await waitFor(
      "cleanup main idle while child still runs",
      () =>
        !mailbox.laneActive(cleanupAgent.id, null) &&
        mailbox.getDelivery(cleanupChildId)?.delivery.status === "running",
    );
    await runCauseEffect(agents.deleteAgentHistory(cleanupAgent.id));
    assert.equal(mailbox.getDelivery(cleanupChildId)?.delivery.status, "running");
    assert.equal(mailbox.getDelivery(cleanupChildId)?.delivery.turnId, cleanupChildSession.turnId);
    assert.equal(mailbox.taskIdForDelivery(cleanupChildId), cleanupChildTaskId);
    assert.ok(
      agents
        .listTasks(cleanupAgent.id)
        .tasks.some((task) => task.id === cleanupChildTaskId && task.state === "running"),
    );
    assert.ok(
      agents
        .readTask(cleanupAgent.id, cleanupChildTaskId)
        .messages.some(
          (message) => message.author === "user" && message.text === "SERVICE_CHILD_SURVIVES_MAIN_HISTORY_DELETE",
        ),
    );
    assert.equal((await runCauseEffect(agents.readConversation(cleanupAgent.id))).messages.length, 0);
    report.checks.push(
      "Deleting idle main history removes its inert acknowledgements without cancelling or deleting the active child delivery, conversation or provider session.",
    );

    const decisionsBeforeSetup = routingInputs.length;
    routingDefault = "thread";
    const setupAgent = await runCauseEffect(
      agents.createAgent(
        {
          name: "AgentSetup",
          description: "Agent-created setup fixture.",
          avatarSeed: "agent-setup",
          avatarHue: null,
          initialMessage: "SERVICE_AGENT_SETUP",
        },
        undefined,
        undefined,
        undefined,
        false,
        true,
      ),
    );
    routingDefault = "queue";
    const setupDelivery = await waitFor("agent-created setup stays on main", () =>
      mailbox
        .unresolvedDeliveries()
        .find(
          ({ delivery }) =>
            delivery.recipientAgentId === setupAgent.id && delivery.status === "running" && delivery.turnId,
        ),
    );
    assert.equal(mailbox.isAgentSetupDelivery(setupDelivery.delivery.id), true);
    assert.equal(mailbox.taskIdForDelivery(setupDelivery.delivery.id), null);
    assert.equal(agents.listTasks(setupAgent.id).tasks.length, 0);
    assert.equal(routingInputs.length, decisionsBeforeSetup);
    assert.ok(setupDelivery.delivery.turnId);
    const setupSession = await startedFor(setupDelivery.delivery.turnId);
    command({ kind: "finish", threadId: setupSession.threadId, text: "SERVICE_AGENT_SETUP_DONE" });
    await waitFor("agent-created setup main finishes", () => !mailbox.laneActive(setupAgent.id, null));
    report.checks.push(
      "An agent-created setup turn keeps its main thread and setup marker when the default mode is Thread.",
    );

    const mainRequester = await create("MainRequester");
    const mainResponder = await create("MainResponder");
    const mainSessionFor = async (agentId: string) => {
      const active = await waitFor("main request provider turn", () =>
        mailbox
          .unresolvedDeliveries()
          .find(
            ({ delivery }) =>
              delivery.recipientAgentId === agentId &&
              delivery.status === "running" &&
              delivery.turnId &&
              mailbox.taskIdForDelivery(delivery.id) === null,
          ),
      );
      assert.ok(active.delivery.turnId);
      return startedFor(active.delivery.turnId);
    };
    const requesterSession = await mainSessionFor(mainRequester.id);
    const responderInitial = await mainSessionFor(mainResponder.id);
    routingModes.set(incoming.id, "steer");
    mainDispatchAgents.add(incoming.id);
    const decisionsBeforeTeammateSteer = routingInputs.length;
    const teammateSteer = await tool(requesterSession, "send_message", {
      recipientAgentIds: [incoming.id],
      text: "SERVICE_TEAMMATE_STEER",
      expectsReply: true,
    });
    assert.ok(Array.isArray(teammateSteer.deliveries));
    const teammateSteerDelivery = teammateSteer.deliveries[0];
    assert.ok(record(teammateSteerDelivery) && typeof teammateSteerDelivery.id === "string");
    await waitFor("teammate request steers the active main turn", () =>
      log().find((entry) => entry.event === "steered" && entry.deliveryId === teammateSteerDelivery.id),
    );
    assert.equal(mailbox.getDelivery(teammateSteerDelivery.id)?.delivery.turnId, mainTurnId);
    assert.equal(mailbox.getDelivery(teammateSteerDelivery.id)?.delivery.status, "running");
    assert.equal(mailbox.taskIdForDelivery(teammateSteerDelivery.id), null);
    assert.equal(routingInputs.length, decisionsBeforeTeammateSteer);
    mainDispatchAgents.delete(incoming.id);
    routingModes.set(incoming.id, "queue");
    report.checks.push(
      "A teammate request in Steer mode joins the active main turn without classification or a new task.",
    );

    mainDispatchAgents.add(mainResponder.id);
    const oldMainRequest = await tool(requesterSession, "send_message", {
      recipientAgentIds: [mainResponder.id],
      text: "SERVICE_OLD_MAIN_REQUEST",
      expectsReply: true,
    });
    assert.equal(typeof oldMainRequest.messageId, "string");
    command({ kind: "finish", threadId: responderInitial.threadId });
    const oldMainDelivery = await waitFor("older main request enters the current turn", () =>
      mailbox
        .unresolvedDeliveries()
        .find(
          ({ delivery }) =>
            delivery.recipientAgentId === mainResponder.id &&
            delivery.messageId === oldMainRequest.messageId &&
            delivery.status === "running" &&
            delivery.turnId,
        ),
    );
    assert.equal(mailbox.taskIdForDelivery(oldMainDelivery.delivery.id), null);
    assert.ok(oldMainDelivery.delivery.turnId);
    const responderSession = await startedFor(oldMainDelivery.delivery.turnId);
    mainDispatchAgents.delete(mainResponder.id);
    routingModes.set(mainRequester.id, "thread");
    routingDecision = { kind: "new", title: "Independent work during a main request" };
    const decisionsBeforeMainRequest = routingInputs.length;
    const independentMainWork = firstWork(
      await tool(responderSession, "send_message", {
        recipientAgentIds: [mainRequester.id],
        text: "SERVICE_NEW_ACTIONABLE_MAIN_REQUEST",
        expectsReply: true,
      }),
    );
    assert.equal(routingInputs.length, decisionsBeforeMainRequest + 1);
    assert.equal(routingInputs.at(-1)?.senderAgentId, mainResponder.id);
    assert.equal(routingInputs.at(-1)?.agentId, mainRequester.id);
    assert.equal(routingInputs.at(-1)?.text, "SERVICE_NEW_ACTIONABLE_MAIN_REQUEST");
    const independentMainSession = await runningTask(mainRequester.id, independentMainWork.taskId);
    assert.ok(mailbox.laneActive(mainRequester.id, null));
    const explicitMainAnswer = await tool(responderSession, "send_message", {
      recipientAgentIds: [mainRequester.id],
      text: "SERVICE_TRUE_MAIN_REPLY",
      replyToMessageId: oldMainRequest.messageId,
      expectsReply: false,
    });
    assert.ok(Array.isArray(explicitMainAnswer.deliveries));
    const explicitMainAnswerDelivery = explicitMainAnswer.deliveries[0];
    assert.ok(record(explicitMainAnswerDelivery) && typeof explicitMainAnswerDelivery.id === "string");
    assert.equal(mailbox.taskIdForDelivery(explicitMainAnswerDelivery.id), null);
    assert.equal(
      routingInputs.length,
      decisionsBeforeMainRequest + 1,
      "An explicit main reply bypasses classification.",
    );
    await runCauseEffect(agents.cancelQueuedMessage(mainRequester.id, explicitMainAnswerDelivery.id));
    command({ kind: "finish", threadId: independentMainSession.threadId, text: "SERVICE_INDEPENDENT_MAIN_WORK_DONE" });
    const returnedMainWork = await waitFor("side work returns to its original requester", () =>
      mailbox
        .listQueue(mainResponder.id)
        .deliveries.find(
          (delivery) => delivery.status === "queued" && delivery.text.includes("SERVICE_INDEPENDENT_MAIN_WORK_DONE"),
        ),
    );
    assert.equal(returnedMainWork.replyToMessageId, independentMainWork.messageId);
    assert.equal(mailbox.taskIdForDelivery(returnedMainWork.id), null);
    assert.equal(returnedMainWork.sender.kind, "agent");
    assert.equal(
      mailbox
        .listQueue(mainResponder.id)
        .deliveries.filter((delivery) => delivery.replyToMessageId === independentMainWork.messageId).length,
      1,
    );
    await runCauseEffect(agents.cancelQueuedMessage(mainResponder.id, returnedMainWork.id));
    command({ kind: "finish", threadId: responderSession.threadId });
    await waitFor("main responder becomes idle", () => !mailbox.laneActive(mainResponder.id, null));

    const externalConnection = agents.messaging.store.ensureConnection(
      "slack",
      "fixture-external-return",
      "Fixture external workspace",
    );
    const externalLink = agents.messaging.store.ensureLink({
      connectionId: externalConnection.connectionId,
      agentId: mainRequester.id,
      platformChannelId: "fixture-channel",
      threadKey: "fixture-return",
      isDirect: false,
      title: "External return fixture",
    });
    const externalOrigin = {
      linkId: externalLink.linkId,
      authorId: "fixture-member",
      authorName: "Fixture member",
      platformMessageId: "fixture-external-message",
    };
    const externalRequest = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: mainRequester.id },
        recipientAgentIds: [mainResponder.id],
        text: "SERVICE_REQUEST_FROM_EXTERNAL_CONTEXT",
        messagingReturn: externalOrigin,
      }),
    );
    const wakeExternal = await runCauseEffect(
      agents.sendMessage({ agentId: mainResponder.id, text: "SERVICE_WAKE_EXTERNAL_REQUEST" }),
    );
    const externalRequestDelivery = await waitFor("external-origin request enters a real turn", () => {
      const delivery = mailbox.getDelivery(externalRequest.deliveries[0]?.id ?? "")?.delivery;
      return delivery?.status === "running" && delivery.turnId ? delivery : null;
    });
    assert.ok(externalRequestDelivery.turnId);
    const wakeExternalId = wakeExternal.deliveries[0]?.id;
    assert.ok(wakeExternalId);
    if (mailbox.getDelivery(wakeExternalId)?.delivery.status === "queued")
      await runCauseEffect(agents.cancelQueuedMessage(mainResponder.id, wakeExternalId));
    const externalResponderSession = await startedFor(externalRequestDelivery.turnId);
    const decisionsBeforeExternalAnswer = routingInputs.length;
    const externalAnswer = await tool(externalResponderSession, "send_message", {
      recipientAgentIds: [mainRequester.id],
      text: "SERVICE_INFERRED_EXTERNAL_REPLY",
      expectsReply: true,
    });
    assert.ok(Array.isArray(externalAnswer.deliveries));
    const externalAnswerDelivery = externalAnswer.deliveries[0];
    assert.ok(record(externalAnswerDelivery) && typeof externalAnswerDelivery.id === "string");
    const externalAnswerDeliveryId = externalAnswerDelivery.id;
    assert.deepEqual(mailbox.messagingOrigin(externalAnswerDelivery.id), externalOrigin);
    assert.equal(mailbox.taskIdForDelivery(externalAnswerDelivery.id), null);
    assert.equal(
      routingInputs.length,
      decisionsBeforeExternalAnswer,
      "An inferred external reply preserves its messaging route.",
    );
    assert.equal(
      mailbox.laneIdForDelivery(externalAnswerDeliveryId),
      MESSAGING_LANE,
      "An external reply retains the released 0.72 messaging lane.",
    );
    assert.equal(mailbox.laneActive(mainRequester.id, null), true, "The requester main turn still runs.");
    const externalAnswerRunning = await waitFor("external answer starts beside main in its own link", () => {
      const delivery = mailbox.getDelivery(externalAnswerDeliveryId)?.delivery;
      return delivery?.status === "running" && delivery.turnId ? delivery : null;
    });
    assert.ok(externalAnswerRunning.turnId);
    const externalAnswerSession = await startedFor(externalAnswerRunning.turnId);
    assert.equal(
      externalAnswerSession.threadId,
      database.activeProviderSession(externalLink.threadId, "codex")?.externalSessionId,
      "The released messaging lane executes this answer in its external conversation.",
    );
    assert.notEqual(externalAnswerSession.threadId, requesterSession.threadId);
    assert.equal(mailbox.laneIdForDelivery(externalAnswerDeliveryId), MESSAGING_LANE);
    assert.equal(mailbox.laneActive(mainRequester.id, MESSAGING_LANE), true);
    assert.equal(mailbox.laneActive(mainRequester.id, null), true);
    assert.equal(
      (await runCauseEffect(agents.readConversation(mainRequester.id))).activeTurnId,
      requesterSession.turnId,
    );
    assert.equal(
      routingInputs.length,
      decisionsBeforeExternalAnswer,
      "Starting the external session does not classify again.",
    );
    command({ kind: "finish", threadId: externalAnswerSession.threadId, text: "SERVICE_EXTERNAL_ROUTE_DONE" });
    await waitFor(
      "external answer turn settles before fixture cleanup",
      () => mailbox.getDelivery(externalAnswerDeliveryId)?.delivery.status === "completed",
    );
    assert.equal(mailbox.laneActive(mainRequester.id, null), true, "The external reply does not finish main work.");
    command({ kind: "finish", threadId: requesterSession.threadId, text: "SERVICE_REQUESTER_MAIN_DONE" });
    for (const delivery of mailbox.listQueue(mainResponder.id).deliveries)
      if (delivery.status === "queued") await runCauseEffect(agents.cancelQueuedMessage(mainResponder.id, delivery.id));
    command({ kind: "finish", threadId: externalResponderSession.threadId });
    await waitFor(
      "routing regression fixture releases its provider capacity",
      () =>
        !mailbox
          .unresolvedDeliveries()
          .some(
            ({ delivery }) =>
              [mainRequester.id, mainResponder.id].includes(delivery.recipientAgentId) && delivery.status === "running",
          ),
    );
    report.checks.push(
      "A new actionable request still reaches the classifier when an older main request from its target is in the active turn; explicit main replies retain main, and inferred external replies use the released messaging lane beside active main without classification.",
    );

    const source = await create("Coordinator");
    const worker = await create("Worker");
    const relay = await create("Relay");
    const sourceTask = await runCauseEffect(agents.startTask({ agentId: source.id, text: "SERVICE_SOURCE_TASK_HOLD" }));
    const sourceSession = await runningTask(source.id, sourceTask.id);
    const dispatch = async (workKey: string, recipientAgentId = worker.id) =>
      firstWork(
        await tool(sourceSession, "dispatch_work", {
          recipientAgentId,
          workKey,
          requestId: `request-${workKey}`,
          text: `SERVICE_WORK_${workKey}`,
        }),
      );
    const alpha = await dispatch("alpha");
    const beta = await dispatch("beta");
    const alphaSession = await runningTask(worker.id, alpha.taskId);
    const betaSession = await runningTask(worker.id, beta.taskId);
    assert.notEqual(alphaSession.threadId, betaSession.threadId);
    assert.ok(mailbox.laneActive(worker.id, null), "The worker's main chat remains busy.");
    report.checks.push("Two work requests start in distinct side sessions while the recipient main chat is busy.");
    const decisionsBeforeSideAnswer = routingInputs.length;
    const inferredSideAnswer = await tool(betaSession, "send_message", {
      recipientAgentIds: [source.id],
      text: "SERVICE_INFERRED_SIDE_FOLLOWUP",
      expectsReply: true,
    });
    assert.ok(Array.isArray(inferredSideAnswer.deliveries));
    const inferredSideDelivery = inferredSideAnswer.deliveries[0];
    assert.ok(record(inferredSideDelivery) && typeof inferredSideDelivery.id === "string");
    assert.equal(mailbox.taskIdForDelivery(inferredSideDelivery.id), sourceTask.id);
    assert.equal(routingInputs.length, decisionsBeforeSideAnswer);
    report.checks.push("A follow-up inferred from a requester's side chat stays in that chat without classification.");

    const followup = firstWork(
      await tool(sourceSession, "dispatch_work", {
        recipientAgentId: worker.id,
        taskId: alpha.taskId,
        requestId: "alpha-followup",
        text: "SERVICE_ALPHA_FOLLOWUP",
      }),
    );
    assert.equal(followup.taskId, alpha.taskId);
    assert.equal(agents.listTasks(worker.id).tasks.length, 2);
    assert.ok(mailbox.taskQueue(worker.id, alpha.taskId).some((item) => item.messageId === followup.messageId));
    command({ kind: "finish", threadId: alphaSession.threadId, text: "SERVICE_ALPHA_REPLY" });
    await waitFor("alpha reply in source side thread", () =>
      mailbox.taskQueue(source.id, sourceTask.id).find((item) => item.text.includes("SERVICE_ALPHA_REPLY")),
    );
    const alphaNext = await waitFor("follow-up turn", () =>
      agents
        .listTasks(worker.id)
        .tasks.find(
          (item) => item.id === alpha.taskId && item.activeTurnId && item.activeTurnId !== alphaSession.turnId,
        ),
    );
    assert.ok(alphaNext.activeTurnId);
    assert.equal((await startedFor(alphaNext.activeTurnId)).threadId, alphaSession.threadId);
    assert.equal(
      mailbox.taskQueue(source.id, sourceTask.id).filter((item) => item.text.includes("SERVICE_ALPHA_REPLY")).length,
      1,
    );
    report.checks.push(
      "A follow-up waits in the same work thread; its automatic reply returns once to the source side thread.",
    );

    const backlogReceipt = await runCauseEffect(
      agents.sendMessage({ agentId: source.id, text: "SERVICE_INDEPENDENT_BACKLOG" }),
    );
    const backlogDelivery = backlogReceipt.deliveries[0];
    assert.ok(backlogDelivery);
    const queuedWork = await tool(sourceSession, "list_queued_work", {});
    assert.ok(Array.isArray(queuedWork.work));
    assert.ok(queuedWork.work.some((item) => record(item) && item.deliveryId === backlogDelivery.id && item.eligible));
    const movedBacklog = await tool(sourceSession, "dispatch_queued_work", { deliveryId: backlogDelivery.id });
    assert.equal(movedBacklog.deliveryId, backlogDelivery.id);
    assert.equal(movedBacklog.messageId, backlogReceipt.messageId);
    assert.ok(record(movedBacklog.work) && typeof movedBacklog.work.taskId === "string");
    const backlogSession = await runningTask(source.id, movedBacklog.work.taskId);
    assert.ok(mailbox.laneActive(source.id, null), "The main chat stays busy while selected backlog starts.");
    command({ kind: "finish", threadId: backlogSession.threadId, text: "SERVICE_BACKLOG_DONE" });
    report.checks.push(
      "The real provider tools move selected existing backlog once and start it while the main chat stays busy.",
    );

    const chain = await dispatch("chain", relay.id);
    const relaySession = await runningTask(relay.id, chain.taskId);
    const leaf = firstWork(
      await tool(relaySession, "dispatch_work", {
        recipientAgentId: worker.id,
        workKey: "leaf",
        requestId: "leaf-request",
        text: "SERVICE_LEAF_REQUEST",
      }),
    );
    const leafSession = await runningTask(worker.id, leaf.taskId);
    command({ kind: "finish", threadId: relaySession.threadId });
    await waitFor("relay delegate turn to end", () =>
      agents
        .listTasks(relay.id)
        .tasks.find(
          (item) =>
            item.id === chain.taskId &&
            item.outcome === "completed" &&
            !item.activeTurnId &&
            !mailbox.taskBusy(relay.id, item.id),
        ),
    );
    assert.equal(
      mailbox
        .taskQueue(source.id, sourceTask.id)
        .filter((item) => item.sender.kind === "agent" && item.sender.agentId === relay.id).length,
      0,
      "Delegation must not send a no-result answer upstream.",
    );
    command({ kind: "finish", threadId: leafSession.threadId, text: "SERVICE_LEAF_REPLY" });
    const relayNext = await waitFor("leaf reply starts relay continuation", () =>
      agents
        .listTasks(relay.id)
        .tasks.find(
          (item) => item.id === chain.taskId && item.activeTurnId && item.activeTurnId !== relaySession.turnId,
        ),
    );
    assert.ok(relayNext.activeTurnId);
    const relayReply = await startedFor(relayNext.activeTurnId);
    assert.equal(relayReply.threadId, relaySession.threadId);
    await tool(relayReply, "send_message", {
      recipientAgentIds: [source.id],
      text: "SERVICE_CHAIN_REPLY",
      replyToMessageId: chain.messageId,
      expectsReply: false,
    });
    await waitFor("chain reply in original source side thread", () =>
      mailbox.taskQueue(source.id, sourceTask.id).find((item) => item.text.includes("SERVICE_CHAIN_REPLY")),
    );
    command({ kind: "finish", threadId: relayReply.threadId });
    await waitFor("relay explicit answer turn to end", () =>
      agents
        .listTasks(relay.id)
        .tasks.find(
          (item) =>
            item.id === chain.taskId &&
            item.outcome === "completed" &&
            !item.activeTurnId &&
            !mailbox.taskBusy(relay.id, item.id),
        ),
    );
    assert.equal(
      mailbox
        .taskQueue(source.id, sourceTask.id)
        .filter((item) => item.sender.kind === "agent" && item.sender.agentId === relay.id).length,
      1,
      "The chain returns one answer and no synthetic no-result duplicate.",
    );
    report.checks.push(
      "Delegation ends without a false no-result reply; the leaf answer resumes the relay work thread and the relay reply reaches the original source thread.",
    );

    let index = 0;
    while (agents.listTasks(worker.id).tasks.filter((item) => item.state === "running").length < 50) {
      const work = await dispatch(`scale-${++index}`);
      await runningTask(worker.id, work.taskId);
    }
    const active: AgentTask[] = agents.listTasks(worker.id).tasks.filter((item) => item.state === "running");
    const sessions = await Promise.all(
      active.map(async (task) => {
        assert.ok(task.activeTurnId);
        return startedFor(task.activeTurnId);
      }),
    );
    assert.equal(new Set(sessions.map((session) => session.threadId)).size, 50);
    report.fakeSessions = 50;
    await tool(
      sourceSession,
      "dispatch_work",
      {
        recipientAgentId: worker.id,
        workKey: "over-capacity",
        requestId: "over-capacity",
        text: "SERVICE_OVER_CAPACITY",
      },
      false,
    );
    assert.equal(agents.listTasks(worker.id).tasks.filter((item) => item.state === "running").length, 50);
    report.checks.push(
      "The real DrainScheduler starts fifty concurrent Codex sessions; the next new work is refused at the open-thread bound.",
    );

    await runCauseEffect(agents.stopTask({ agentId: worker.id, taskId: beta.taskId }));
    await waitFor("provider interruption closes beta", () =>
      agents
        .listTasks(worker.id)
        .tasks.find((item) => item.id === beta.taskId && !item.activeTurnId && !mailbox.taskBusy(worker.id, item.id)),
    );
    const restarted = await dispatch("after-interrupt");
    await runningTask(worker.id, restarted.taskId);
    assert.equal(agents.listTasks(worker.id).tasks.filter((item) => item.state === "running").length, 50);
    report.checks.push("A real provider interrupt and completion release task capacity for replacement work.");
    report.passed = true;
  } finally {
    await runCauseEffect(agents.stop()).catch((cause) => {
      errors.push(String(cause));
    });
    database.close();
    writeFileSync(join(root, "errors.json"), `${JSON.stringify(errors, null, 2)}\n`);
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (cause) {
    report.error = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
} else {
  const build = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(build.success, String(build.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_WORK_SERVICE_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assert.ifError(child.error);
  assert.equal(child.status, 0, "Server work service fixture failed.");
}
