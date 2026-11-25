import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  latestTurnAnswer,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type RoutineRun,
  routineQuietStepsItemId,
  routineRunConversationEvent,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-report-failure-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-failure-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentRoutineStore } = await import("../src/backend/agent-routine-store");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { routineFlowRoutines } = await import("../src/backend/routine-flows/routine-flow-routines");
const { RoutineFlowStore } = await import("../src/backend/routine-flows/routine-flow-store");
const { createRoutineFlows } = await import("../src/backend/routine-flows/routine-flows");
const { RoutineResultStore } = await import("../src/backend/routine-results/routine-result-store");

const SECRET = "sk-ant-abcdefgh1234567890";
const REASON = `ssh: connect to host 10.0.0.5 port 22: Connection refused (key ${SECRET})`;
const FAILED_ANSWER = "FAILED: the server is not reachable.";
const PROVIDER_ERROR = "The fake provider stopped.";
const NO_ANSWER_ERROR = "The fake provider sent no answer.";
const NOTICE_TEXT = "Before the check: I run one harmless command and report the result to my teammate.";
const LINK_REASON = "The mirror is down.";

interface FakeCall {
  tool: "routine_report_failure" | "routine_no_update" | "list_routines" | "send_message" | "update_routine";
  arguments: {
    reason?: string;
    routineId?: string;
    active?: boolean;
    agentId?: string;
    recipientAgentIds?: string[];
    text?: string;
    expectsReply?: boolean;
  };
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;
const reportFailure = (reason: string): FakeCall => ({ tool: "routine_report_failure", arguments: { reason } });
const noUpdate: FakeCall = { tool: "routine_no_update", arguments: {} };
const listRoutines: FakeCall = { tool: "list_routines", arguments: {} };
const pauseRoutine = (routineId: string): FakeCall => ({
  tool: "update_routine",
  arguments: { routineId, active: false },
});
const replyCalls = (...items: FakeCall[]) => `<<REPLY${JSON.stringify(items)}REPLY>>`;

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
const looping = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turn) => {
  const { threadId, turnId } = turn;
  if (turn.providerFail) {
    write({ method: "error", params: { threadId, turnId, error: { message: ${JSON.stringify(PROVIDER_ERROR)} }, willRetry: false } });
    return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed" } } });
  }
  if (turn.silentFail) return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed" } } });
  if (turn.quietHang) return;
  if (turn.noFinal) return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  if (turn.emptyAnswer) {
    write({ method: "error", params: { threadId, turnId, message: ${JSON.stringify(NO_ANSWER_ERROR)}, causeCode: "empty_answer" } });
    return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed" } } });
  }
  const item = { type: "agentMessage", id: "message-" + turnId, text: turn.reply, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const callNext = (turn) => {
  if (turn.stopped) return;
  if (turn.quietLoop && turn.calls.length === 0) {
    looping.set(turn.turnId, turn);
    turn.calls.push({ tool: "routine_no_update", arguments: {} });
    if (turn.loops++ > 0) return setTimeout(() => callNext(turn), 200);
  }
  const call = turn.calls.shift();
  if (!call) return setTimeout(() => finish(turn), 20);
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, { turn, tool: call.tool });
  write({
    id,
    method: "item/tool/call",
    params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments || {} },
  });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      log({ method: "turn/start", threadId: params.threadId, turnId, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const start = text.lastIndexOf("--- routine task ---");
      const task = start >= 0 ? text.slice(start) : text;
      const answered = text.includes("This replies to message:") ? /<<REPLY([\\s\\S]*?)REPLY>>/.exec(task) : null;
      const named = answered || /<<CALLS([\\s\\S]*?)CALLS>>/.exec(task);
      const next = /<<NEXT([\\s\\S]*?)NEXT>>/.exec(task);
      const request = !named && task.includes("TEAMMATE-REQUEST") ? /Message from OpenBot teammate .*? \\(([^()\\s]+)\\)\\.\\nMessage ID: (\\S+)/.exec(task) : null;
      const requestReply = request && { tool: "send_message", arguments: { recipientAgentIds: [request[1]], replyToMessageId: request[2], text: "Status: done\\nResult: The build passed.\\nEvidence: none", expectsReply: false } };
      const textOnly = task.includes("TEAMMATE-REQUEST-TEXT");
      const turnCalls = named ? JSON.parse(named[1]) : task.includes("TEAMMATE-REQUEST-NOREPLY") ? [] : textOnly ? [requestReply] : requestReply ? [{ tool: "routine_no_update", arguments: {} }, requestReply, { tool: "routine_no_update", arguments: {} }] : task.includes("TEAMMATE-QUIET") ? [{ tool: "routine_no_update", arguments: {} }] : [];
      if (task.includes("NOTICE")) {
        const hex = (0xa000 + turns).toString(16);
        for (const [id, noteText] of [["msg_" + hex, ${JSON.stringify(NOTICE_TEXT)}], ["rs_" + hex, "Thinking about the check."]])
          write({ method: "item/completed", params: { threadId: params.threadId, turnId, item: { type: "agentMessage", id, text: noteText, phase: "commentary" } } });
      }
      if (task.includes("RUN-STEP")) {
        const command = { type: "commandExecution", id: "command-" + turnId, command: "ls", cwd: "/tmp", status: "inProgress" };
        write({ method: "item/started", params: { threadId: params.threadId, turnId, item: command } });
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item: { ...command, status: "completed", aggregatedOutput: "", exitCode: 0 } } });
      }
      if (task.includes("NO-UPDATE-ITEM")) {
        const call = { type: "dynamicToolCall", id: "no-update-" + turnId, namespace: "openbot", tool: "routine_no_update", arguments: {}, status: "inProgress" };
        write({ method: "item/started", params: { threadId: params.threadId, turnId, item: call } });
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item: { ...call, status: "completed", success: true, contentItems: [] } } });
      }
      const reply = next ? "Relay report <<CALLS" + next[1] + "CALLS>>" : textOnly ? "The result went to the teammate." : turnCalls.length ? ${JSON.stringify(FAILED_ANSWER)} : "All good.";
      return callNext({ threadId: params.threadId, turnId, calls: turnCalls, reply, providerFail: task.includes("PROVIDER-FAIL"), silentFail: task.includes("SILENT-FAIL"), emptyAnswer: task.includes("EMPTY-ANSWER"), quietHang: task.includes("QUIET-HANG"), quietLoop: task.includes("QUIET-LOOP"), noFinal: task.includes("NO-FINAL"), loops: 0 });
    }
    case "turn/interrupt": {
      log({ method: "turn/interrupt", threadId: params.threadId, turnId: params.turnId });
      const loop = looping.get(params.turnId);
      if (loop) loop.stopped = true;
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const { turn, tool } = waiting.get(message.id);
        waiting.delete(message.id);
        log({ method: "tool-result", turnId: turn.turnId, tool, result: message.result ?? null, error: message.error ?? null });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface LogEntry {
  method: string;
  threadId?: string;
  turnId: string;
  text?: string;
  tool?: string;
  result?: { success: boolean; contentItems: { type: string; text: string }[] } | null;
}

const report: {
  runs: Record<string, Pick<RoutineRun, "status" | "error"> & { deliveryStatus?: string | null }>;
  flowSteps: Record<string, { agent: string; status: string; error: string | null }[]>;
  resultRuns: string[];
  pauseReasons?: Record<string, string | undefined>;
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { runs: {}, flowSteps: {}, resultRuns: [], checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function fakeEntries(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const turnAnswer = (agentId: string, turnId: string): string | null =>
  latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, turnId), turnId)?.text ?? null;
const flowStore = new RoutineFlowStore({ database: store.database });
const flows = await Effect.runPromise(
  createRoutineFlows({
    store: flowStore,
    routines: routineFlowRoutines(new AgentRoutineStore(store.database)),
    delivery: (deliveryId) => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
    },
    turnAnswer,
    agentName: (agentId) => store.list().find((agent) => agent.id === agentId)?.name ?? agentId,
    sendHandoff: (input) => agents.enqueueRoutineHandoff(input),
    stopRoutineRun: (input) => agents.stopRoutineRun(input),
    stopDelivery: () => Effect.void,
    changed: () => {},
  }),
);
const results = new RoutineResultStore(store.database);
const events: AgentEvent[] = [];
agents.on("event", (event) => {
  events.push(event);
  Effect.runFork(flows.notice(event));
});

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

async function createAgent(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks failed routine runs.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s thread`, () => store.list().find((entry) => entry.id === agent.id)?.threadId);
  await waitFor(`${name}'s first turn`, () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  return agent;
}

function createRoutine(agentId: string, name: string, instruction: string) {
  return agents.createRoutine({
    agentId,
    name,
    instruction,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    runIn: "thread",
  });
}

async function settledRun(name: string, run: RoutineRun, timeoutMs?: number) {
  const deliveryId = run.deliveryId;
  assert.ok(deliveryId, `${name}: no delivery`);
  const delivery = await waitFor(
    `${name} delivery`,
    () => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return ended(found?.status) ? found : null;
    },
    timeoutMs,
  );
  const ranRun = await waitFor(`${name} run`, () => {
    const found = agents
      .listRoutineRuns({ agentId: run.agentId, routineId: run.routineId })
      .find((entry) => entry.id === run.id);
    return found && !["queued", "running"].includes(found.status) ? found : null;
  });
  report.runs[name] = { status: ranRun.status, error: ranRun.error, deliveryStatus: delivery.status };
  return { delivery, run: ranRun };
}

function toolResults(turnId: string | null, tool: string) {
  return fakeEntries().filter(
    (entry) => entry.method === "tool-result" && entry.turnId === turnId && entry.tool === tool,
  );
}

async function steps(name: string, runId: string, count: number) {
  const ready = await waitFor(`${name} flow steps`, () => {
    const found = flowStore.steps(runId);
    return found.length >= count && found.every((step) => !["waiting", "running"].includes(step.status)) ? found : null;
  });
  const names = new Map(store.list().map((agent) => [agent.id, agent.name]));
  report.flowSteps[name] = ready.map((step) => ({
    agent: names.get(step.agentId) ?? step.agentId,
    status: step.status,
    error: step.error,
  }));
  return ready;
}

try {
  await runCauseEffect(agents.initialize());
  const checker = await createAgent("Checker");
  const relay = await createAgent("Relay");
  const responder = await createAgent("Responder");
  const finisher = await createAgent("Finisher");
  const since = new Date().toISOString();

  const health = createRoutine(
    checker.id,
    "Health check",
    `Check the server. ${calls(listRoutines, reportFailure(REASON))}`,
  );
  const plain = createRoutine(checker.id, "Plain check", "Check the build.");
  const broken = createRoutine(checker.id, "Broken check", "Check the disk. PROVIDER-FAIL");
  const silent = createRoutine(checker.id, "Silent check", "Check the disk. SILENT-FAIL");
  const quietFailed = createRoutine(
    checker.id,
    "Quiet failed",
    `Check quietly. ${calls(noUpdate, reportFailure(REASON))}`,
  );
  const quietOk = createRoutine(checker.id, "Quiet ok", `Check quietly. NOTICE ${calls(noUpdate)}`);
  const quietEmpty = createRoutine(checker.id, "Quiet empty", `Check quietly. EMPTY-ANSWER ${calls(noUpdate)}`);
  const quietHang = createRoutine(checker.id, "Quiet hang", `Check quietly. QUIET-HANG ${calls(noUpdate)}`);
  const quietLoop = createRoutine(checker.id, "Quiet loop", "Check quietly. QUIET-LOOP");
  const quietSteps = createRoutine(
    checker.id,
    "Quiet steps",
    `Check quietly. RUN-STEP NO-UPDATE-ITEM NO-FINAL ${calls(noUpdate)}`,
  );
  const quietMarker = createRoutine(
    checker.id,
    "Quiet marker",
    `Check quietly. NO-UPDATE-ITEM NO-FINAL ${calls(noUpdate)}`,
  );
  const empty = createRoutine(checker.id, "Empty check", "Check the logs. EMPTY-ANSWER");
  const failedThenQuiet = createRoutine(
    checker.id,
    "Failed then quiet",
    `Check quietly. ${calls(reportFailure(REASON), noUpdate)}`,
  );
  const relayed = createRoutine(
    relay.id,
    "Mirror check",
    `Check the mirror and hand on. <<NEXT${JSON.stringify([reportFailure(LINK_REASON)])}NEXT>>`,
  );
  const destination = {
    connectionId: "connection-1",
    platform: "slack" as const,
    connectionName: "Team",
    placeId: "C1",
    placeName: "#ops",
  };
  store.database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections (connection_id, platform, workspace_id, workspace_name, enabled,
         created_at, updated_at) VALUES (?, 'slack', 'T1', 'Team', 1, ?, ?)`,
    )
    .run(destination.connectionId, since, since);
  for (const routine of [health, plain, broken]) results.setDestination(routine.id, destination, since);
  const connect = (routineId: string, fromAgentId: string, toAgentId: string) =>
    Effect.runPromise(flows.connect({ routineId, fromAgentId, toAgentId }));
  await connect(health.id, checker.id, responder.id);
  await connect(relayed.id, relay.id, responder.id);
  await connect(relayed.id, responder.id, finisher.id);

  const chatReceipt = await runCauseEffect(
    agents.sendMessage({ agentId: checker.id, text: `Hello. ${calls(reportFailure("Not a run."))}` }),
  );
  const chatDeliveryId = chatReceipt.deliveries[0]?.id;
  assert.ok(chatDeliveryId);
  const chatDelivery = await waitFor("the chat turn", () => {
    const found = mailbox.getDelivery(chatDeliveryId)?.delivery;
    return ended(found?.status) ? found : null;
  });
  const chatResult = toolResults(chatDelivery.turnId, "routine_report_failure")[0]?.result;
  pass(
    "Outside a routine run the tool fails with the no-update error",
    chatResult?.success === false &&
      chatResult.contentItems.some((item) => item.text.includes("only in a routine run")),
    chatResult,
  );
  pass("A chat turn with a refused call still completes", chatDelivery.status === "completed" && !chatDelivery.error);

  const update: FakeCall = {
    tool: "send_message",
    arguments: { recipientAgentIds: [checker.id], text: "The build is live. TEAMMATE-QUIET", expectsReply: false },
  };
  const updateReceipt = await runCauseEffect(
    agents.sendMessage({ agentId: relay.id, text: `Pass it on. ${calls(update)}` }),
  );
  const updateSenderId = updateReceipt.deliveries[0]?.id;
  assert.ok(updateSenderId);
  await waitFor("the update sender's turn", () => ended(mailbox.getDelivery(updateSenderId)?.delivery.status));
  const sendResult = toolResults(mailbox.getDelivery(updateSenderId)?.delivery.turnId ?? null, "send_message")[0]
    ?.result;
  const updateTurnId = await waitFor(
    "the update's turn",
    () =>
      fakeEntries().find(
        (entry) =>
          entry.method === "turn/start" &&
          entry.text?.includes("The build is live.") === true &&
          !entry.text.includes("<<CALLS"),
      )?.turnId,
  );
  const quietEvent = await waitFor("the update's turn-completed", () =>
    events.find((event) => event.type === "turn-completed" && event.turnId === updateTurnId),
  );
  const quietResult = toolResults(updateTurnId, "routine_no_update")[0]?.result;
  const updateAnswers = store.database.readTurnAssistantMessages(checker.id, updateTurnId);
  pass(
    "A teammate's update that wants no answer ends quiet after routine_no_update",
    quietResult?.success === true &&
      quietEvent.type === "turn-completed" &&
      quietEvent.quiet === true &&
      updateAnswers.length > 0 &&
      updateAnswers.every((message) => message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE) &&
      latestTurnAnswer(updateAnswers, updateTurnId) === undefined,
    { sendResult, quietResult, quietEvent, updateAnswers },
  );

  const ask: FakeCall = {
    tool: "send_message",
    arguments: { recipientAgentIds: [checker.id], text: "Check the release build. TEAMMATE-REQUEST" },
  };
  await runCauseEffect(agents.sendMessage({ agentId: relay.id, text: `Ask for a check. ${calls(ask)}` }));
  const requestTurn = await waitFor("the request's turn", () =>
    fakeEntries().find(
      (entry) =>
        entry.method === "turn/start" &&
        entry.text?.includes("Check the release build.") === true &&
        !entry.text.includes("<<CALLS"),
    ),
  );
  const requestEvent = await waitFor("the request's turn-completed", () =>
    events.find((event) => event.type === "turn-completed" && event.turnId === requestTurn.turnId),
  );
  const [earlyResult, lateResult] = toolResults(requestTurn.turnId, "routine_no_update").map((entry) => entry.result);
  const replyResult = toolResults(requestTurn.turnId, "send_message")[0]?.result;
  const requestAnswers = store.database.readTurnAssistantMessages(checker.id, requestTurn.turnId);
  pass(
    "A teammate's request ends quiet after its result went back to the teammate",
    earlyResult?.success === false &&
      earlyResult.contentItems.some((item) => item.text.includes("send_message first")) &&
      replyResult?.success === true &&
      lateResult?.success === true &&
      lateResult.contentItems.some((item) => item.text.includes('"quiet"')) &&
      requestEvent.type === "turn-completed" &&
      requestEvent.quiet === true &&
      requestAnswers.length > 0 &&
      requestAnswers.every((message) => message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE) &&
      latestTurnAnswer(requestAnswers, requestTurn.turnId) === undefined,
    { earlyResult, replyResult, lateResult, requestEvent, requestAnswers },
  );
  const requestMessageId = /Message ID: (\S+)/.exec(requestTurn.text ?? "")?.[1];
  const repliesToRelay = agents
    .listQueue(relay.id)
    .deliveries.filter(
      (delivery) =>
        delivery.sender.kind === "agent" &&
        delivery.sender.agentId === checker.id &&
        delivery.replyToMessageId === requestMessageId,
    );
  pass("The teammate who asked gets the one reply and no second result", repliesToRelay.length === 1, repliesToRelay);

  const requestTurnOf = async (text: string) => {
    const ask: FakeCall = { tool: "send_message", arguments: { recipientAgentIds: [checker.id], text } };
    await runCauseEffect(agents.sendMessage({ agentId: relay.id, text: `Ask again. ${calls(ask)}` }));
    const turn = await waitFor(`the turn of "${text}"`, () =>
      fakeEntries().find(
        (entry) =>
          entry.method === "turn/start" && entry.text?.includes(text) === true && !entry.text.includes("<<CALLS"),
      ),
    );
    const event = await waitFor(`the turn-completed of "${text}"`, () =>
      events.find((candidate) => candidate.type === "turn-completed" && candidate.turnId === turn.turnId),
    );
    return { turn, event, answers: store.database.readTurnAssistantMessages(checker.id, turn.turnId) };
  };
  const textRequest = await requestTurnOf("Check the docs build. TEAMMATE-REQUEST-TEXT");
  pass(
    "An answered teammate request keeps the agent's text answer in the chat without the no-update tool",
    toolResults(textRequest.turn.turnId, "send_message")[0]?.result?.success === true &&
      toolResults(textRequest.turn.turnId, "routine_no_update").length === 0 &&
      textRequest.event.type === "turn-completed" &&
      textRequest.event.quiet !== true &&
      textRequest.answers.every((message) => message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE) &&
      latestTurnAnswer(textRequest.answers, textRequest.turn.turnId)?.text === "The result went to the teammate.",
    textRequest,
  );
  const noticeRequest = await requestTurnOf("Check the notice build. TEAMMATE-REQUEST-TEXT NOTICE NO-FINAL");
  const notices = noticeRequest.answers.filter((message) => message.id.startsWith("msg_"));
  pass(
    "A quiet teammate request keeps the notice that the agent wrote before its step",
    noticeRequest.event.type === "turn-completed" &&
      noticeRequest.event.quiet === true &&
      toolResults(noticeRequest.turn.turnId, "send_message")[0]?.result?.success === true &&
      notices.length === 1 &&
      notices[0]?.text === NOTICE_TEXT &&
      notices[0]?.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE &&
      noticeRequest.answers.every((message) => !message.id.startsWith("rs_")) &&
      latestTurnAnswer(noticeRequest.answers, noticeRequest.turn.turnId) === undefined,
    noticeRequest,
  );
  const unanswered = await requestTurnOf("Check the site build. TEAMMATE-REQUEST-NOREPLY");
  const unansweredMessageId = /Message ID: (\S+)/.exec(unanswered.turn.text ?? "")?.[1];
  const sentResults = await waitFor("the result for the unanswered request", () => {
    const results = agents
      .listQueue(relay.id)
      .deliveries.filter(
        (delivery) =>
          delivery.sender.kind === "agent" &&
          delivery.sender.agentId === checker.id &&
          delivery.replyToMessageId === unansweredMessageId,
      );
    return results.length > 0 && results;
  });
  const unansweredDelivery = mailbox.completedDeliveriesOfTurn(checker.id, unanswered.turn.turnId)[0]?.delivery;
  pass(
    "A teammate request with no reply keeps its answer in the chat after OpenBot sent it to the teammate",
    unanswered.event.type === "turn-completed" &&
      unanswered.event.quiet !== true &&
      unanswered.answers.every((message) => message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE) &&
      latestTurnAnswer(unanswered.answers, unanswered.turn.turnId)?.text === "All good." &&
      sentResults.length === 1 &&
      sentResults[0]?.text.includes("All good.") === true &&
      unansweredDelivery !== undefined &&
      !mailbox.hasOwnReplyFrom(unansweredDelivery.id) &&
      mailbox.hasSentResultFor(unansweredDelivery.id),
    { unanswered, sentResults, unansweredDelivery },
  );

  const healthRun = await settledRun(
    "Health check",
    await runCauseEffect(agents.testRoutine({ agentId: checker.id, routineId: health.id })),
  );
  const healthTool = toolResults(healthRun.delivery.turnId, "routine_report_failure")[0]?.result;
  pass("The tool call succeeds in a Test run", healthTool?.success === true, healthTool);
  pass("The delivery stays completed", healthRun.delivery.status === "completed");
  pass(
    "The run ends failed with the reason",
    healthRun.run.status === "failed" && healthRun.run.error?.includes("Connection refused") === true,
    healthRun.run,
  );
  pass(
    "The reason is redacted",
    !healthRun.run.error?.includes(SECRET) && healthRun.run.error?.includes("[redacted]") === true,
    healthRun.run.error,
  );
  pass(
    "The run's answer is the turn answer",
    turnAnswer(checker.id, healthRun.delivery.turnId ?? "") === FAILED_ANSWER,
  );
  const healthTurnId = healthRun.delivery.turnId;
  const healthThread = agents.listTasks(checker.id).tasks.find((task) => task.routineId === health.id);
  const chatMessages = (await runCauseEffect(agents.readConversation(checker.id))).messages;
  pass(
    "The run's answer shows in its routine thread, not in the chat",
    healthThread !== undefined &&
      agents
        .readTask(checker.id, healthThread.id)
        .messages.some((message) => message.turnId === healthTurnId && message.text === FAILED_ANSWER) &&
      !chatMessages.some((message) => message.turnId === healthTurnId && message.author === "assistant"),
    healthThread,
  );
  pass("A Test-run turn completes as usual", healthThread?.outcome === "completed");
  const healthPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === healthRun.delivery.turnId,
  )?.text;
  pass("The Test-run prompt names the tool", healthPrompt?.includes("call the routine_report_failure tool") === true);
  pass(
    "The routine prompt says that a teammate request is not a failure",
    healthPrompt?.includes("A request to a teammate is not a failure") === true &&
      healthPrompt.includes("Do not call the routine_report_failure tool only because a reply has not come yet."),
    healthPrompt,
  );
  pass(
    "The routine prompt does not forbid listing routines",
    healthPrompt?.includes("Do not create, update, delete, or test routines during this run.") === true &&
      !healthPrompt.includes("delete, list, or test routines"),
    healthPrompt,
  );
  const routineLanguageLine =
    "in the language that the routine task names, else the language that your instructions name";
  pass(
    "The routine prompt names the routine task as the language of the user-facing lines, before the task",
    healthPrompt?.includes(routineLanguageLine) === true &&
      healthPrompt.indexOf(routineLanguageLine) < healthPrompt.lastIndexOf("--- routine task ---"),
    healthPrompt,
  );
  const listRoutinesTool = toolResults(healthRun.delivery.turnId, "list_routines")[0]?.result;
  pass(
    "A routine run can list routines",
    listRoutinesTool?.success === true &&
      listRoutinesTool.contentItems.some((item) => item.text.includes("Health check")),
    listRoutinesTool,
  );
  const healthTransitions = (await runCauseEffect(agents.readConversation(checker.id))).messages
    .map(routineRunConversationEvent)
    .filter((event) => event?.runId === healthRun.run.id)
    .map((event) => event?.status);
  pass(
    "The run goes from running to failed, never through succeeded",
    healthTransitions.includes("failed") && !healthTransitions.includes("succeeded"),
    healthTransitions,
  );

  const plainRun = await settledRun(
    "Plain check",
    await runCauseEffect(agents.testRoutine({ agentId: checker.id, routineId: plain.id })),
  );
  pass("A run with no call succeeds", plainRun.run.status === "succeeded" && plainRun.run.error === null);
  const brokenRun = await settledRun(
    "Broken check",
    await runCauseEffect(agents.testRoutine({ agentId: checker.id, routineId: broken.id })),
  );
  pass(
    "A provider failure fails the delivery and the run with its own error",
    brokenRun.delivery.status === "failed" &&
      brokenRun.run.status === "failed" &&
      brokenRun.run.error === PROVIDER_ERROR,
    brokenRun.run,
  );
  const silentRun = await settledRun(
    "Silent check",
    await runCauseEffect(agents.testRoutine({ agentId: checker.id, routineId: silent.id })),
  );
  const NO_REASON = sourceText("error.backend.routineRunFailedNoReason");
  pass(
    "A turn that fails with no error fails the run with a reason that says so",
    silentRun.delivery.status === "failed" && silentRun.run.status === "failed" && silentRun.run.error === NO_REASON,
    silentRun.run,
  );

  const laterReceipt = await runCauseEffect(
    agents.sendMessage({ agentId: checker.id, text: `Anything else? ${calls(listRoutines)}` }),
  );
  const laterId = laterReceipt.deliveries[0]?.id;
  assert.ok(laterId);
  await waitFor("the later chat turn", () => ended(mailbox.getDelivery(laterId)?.delivery.status));
  const silentTransitions = (await runCauseEffect(agents.readConversation(checker.id))).messages
    .map(routineRunConversationEvent)
    .filter((event) => event?.runId === silentRun.run.id && event.status === "failed");
  pass("The run with no error has one failed marker", silentTransitions.length === 1, silentTransitions);
  const laterList = toolResults(mailbox.getDelivery(laterId)?.delivery.turnId ?? null, "list_routines")[0]?.result;
  const listed = JSON.parse(laterList?.contentItems.find((item) => item.text.includes("Silent check"))?.text ?? "{}");
  const silentListed = listed.routines?.find((routine: { name: string }) => routine.name === "Silent check");
  pass(
    "list_routines gives the newest run with its reason",
    silentListed?.lastRun?.status === "failed" && silentListed.lastRun.reason === NO_REASON,
    silentListed?.lastRun ?? laterList,
  );
  const olderRun = new AgentRoutineStore(store.database).updateRunStatus(silentRun.run.id, "failed", null);
  const olderReceipt = await runCauseEffect(agents.sendMessage({ agentId: checker.id, text: "One more thing?" }));
  const olderId = olderReceipt.deliveries[0]?.id;
  assert.ok(olderId);
  await waitFor("the next chat turn", () => ended(mailbox.getDelivery(olderId)?.delivery.status));
  const olderAfter = agents
    .listRoutineRuns({ agentId: checker.id, routineId: silent.id })
    .find((run) => run.id === silentRun.run.id);
  pass(
    "An older failed run with no reason stays as it was",
    olderAfter?.status === "failed" && olderAfter.error === null && olderAfter.updatedAt === olderRun.updatedAt,
    olderAfter,
  );
  const healthAfter = agents
    .listRoutineRuns({ agentId: checker.id, routineId: health.id })
    .find((run) => run.id === healthRun.run.id);
  pass(
    "A later queue change keeps the run failed",
    healthAfter?.status === "failed" && healthAfter.error === healthRun.run.error,
  );

  await runCauseEffect(agents.updateAgent({ agentId: checker.id, allowAutomation: true }));
  const quietOkRun = await settledRun(
    "Quiet ok",
    await runCauseEffect(agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietOk.id, payload: "" })),
  );
  pass("A script run with only routine_no_update succeeds", quietOkRun.run.status === "succeeded");
  const quietEmptyRun = await settledRun(
    "Quiet empty",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietEmpty.id, payload: "" }),
    ),
  );
  pass(
    "A script run with no answer after routine_no_update succeeds, with no error",
    quietEmptyRun.run.status === "succeeded" &&
      !quietEmptyRun.run.error &&
      quietEmptyRun.delivery.status === "completed",
    quietEmptyRun.run,
  );
  const quietHangRun = await settledRun(
    "Quiet hang",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietHang.id, payload: "" }),
    ),
    60_000,
  );
  pass(
    "A script run that sends nothing after routine_no_update ends as succeeded, with no error",
    quietHangRun.run.status === "succeeded" &&
      !quietHangRun.run.error &&
      quietHangRun.delivery.status === "completed" &&
      fakeEntries().some((entry) => entry.method === "turn/interrupt" && entry.turnId === quietHangRun.delivery.turnId),
    quietHangRun.run,
  );
  const quietLoopStarted = Date.now();
  const quietLoopRun = await settledRun(
    "Quiet loop",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietLoop.id, payload: "" }),
    ),
    20_000,
  );
  const quietLoopCalls = toolResults(quietLoopRun.delivery.turnId, "routine_no_update");
  pass(
    "A script run that calls routine_no_update again ends as succeeded at once, with no error",
    quietLoopRun.run.status === "succeeded" &&
      !quietLoopRun.run.error &&
      quietLoopRun.delivery.status === "completed" &&
      quietLoopCalls.length >= 2 &&
      quietLoopCalls.every((call) => call.result?.contentItems.some((item) => item.text.includes('"quiet"'))) &&
      Date.now() - quietLoopStarted < 15_000 &&
      fakeEntries().some((entry) => entry.method === "turn/interrupt" && entry.turnId === quietLoopRun.delivery.turnId),
    { run: quietLoopRun.run, calls: quietLoopCalls.length, ms: Date.now() - quietLoopStarted },
  );
  const emptyRun = await settledRun(
    "Empty check",
    await runCauseEffect(agents.runRoutineFromAutomation({ agentId: checker.id, routineId: empty.id, payload: "" })),
  );
  pass(
    "A script run with no answer and no routine_no_update still fails with its error",
    emptyRun.run.status === "failed" && emptyRun.run.error === NO_ANSWER_ERROR,
    emptyRun.run,
  );
  const quietFailedRun = await settledRun(
    "Quiet failed",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietFailed.id, payload: "" }),
    ),
  );
  pass("A script run that reports a failure after routine_no_update fails", quietFailedRun.run.status === "failed");
  const failedThenQuietRun = await settledRun(
    "Failed then quiet",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: failedThenQuiet.id, payload: "" }),
    ),
  );
  const noUpdateAfterFailure = toolResults(failedThenQuietRun.delivery.turnId, "routine_no_update")[0]?.result;
  pass(
    "routine_no_update after a reported failure asks for the answer",
    noUpdateAfterFailure?.contentItems.some((item) => item.text.includes('"shown"')) === true &&
      failedThenQuietRun.run.status === "failed",
    noUpdateAfterFailure,
  );
  const routineThreadOf = (routineId: string) =>
    agents.listTasks(checker.id).tasks.find((task) => task.routineId === routineId);
  const shownAnswers = (routineId: string, turnId: string | null) => {
    const thread = routineThreadOf(routineId);
    if (!thread) return null;
    return agents
      .readTask(checker.id, thread.id)
      .messages.filter(
        (message) =>
          message.turnId === turnId &&
          message.author === "assistant" &&
          message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE,
      )
      .map((message) => message.text);
  };
  const quietness = {
    quietOk: shownAnswers(quietOk.id, quietOkRun.delivery.turnId),
    quietFailed: shownAnswers(quietFailed.id, quietFailedRun.delivery.turnId),
    failedThenQuiet: shownAnswers(failedThenQuiet.id, failedThenQuietRun.delivery.turnId),
  };
  pass(
    "A failed script run is not quiet, also after routine_no_update, and a quiet run is",
    quietness.quietOk?.length === 0 &&
      quietness.quietFailed?.includes(FAILED_ANSWER) === true &&
      quietness.failedThenQuiet?.includes(FAILED_ANSWER) === true,
    quietness,
  );
  const quietOkThread = routineThreadOf(quietOk.id);
  const quietOkNotes = quietOkThread
    ? agents
        .readTask(checker.id, quietOkThread.id)
        .messages.filter((message) => message.turnId === quietOkRun.delivery.turnId && message.author === "assistant")
    : [];
  pass(
    "A quiet script run keeps the notice that the agent wrote before its step",
    quietOkNotes.some(
      (message) =>
        message.id.startsWith("msg_") &&
        message.text === NOTICE_TEXT &&
        message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE,
    ) &&
      quietOkNotes.every(
        (message) =>
          !message.id.startsWith("rs_") && message.id !== routineQuietStepsItemId(quietOkRun.delivery.turnId ?? ""),
      ),
    quietOkNotes,
  );
  const quietStepsRun = await settledRun(
    "Quiet steps",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietSteps.id, payload: "" }),
    ),
  );
  const quietStepsThread = routineThreadOf(quietSteps.id);
  const quietStepsTurn = quietStepsRun.delivery.turnId;
  const quietStepsRows = quietStepsThread
    ? agents
        .readTask(checker.id, quietStepsThread.id)
        .messages.filter((message) => message.turnId === quietStepsTurn && message.author === "assistant")
    : [];
  const quietStepsCarrier = quietStepsRows[0];
  pass(
    "A quiet script run with no text keeps the steps of its run in one empty row",
    quietStepsRun.run.status === "succeeded" &&
      quietStepsTurn !== null &&
      quietStepsRows.length === 1 &&
      quietStepsCarrier?.id === routineQuietStepsItemId(quietStepsTurn) &&
      quietStepsCarrier.itemType === "commentary" &&
      quietStepsCarrier.text === "" &&
      quietStepsCarrier.trace?.steps.some((step) => step.kind === "tool" && step.command === "ls") === true &&
      latestTurnAnswer(quietStepsRows, quietStepsTurn) === undefined,
    { run: quietStepsRun.run, rows: quietStepsRows },
  );
  const quietMarkerRun = await settledRun(
    "Quiet marker",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietMarker.id, payload: "" }),
    ),
  );
  const quietMarkerThread = routineThreadOf(quietMarker.id);
  const quietMarkerRows = quietMarkerThread
    ? agents
        .readTask(checker.id, quietMarkerThread.id)
        .messages.filter(
          (message) => message.turnId === quietMarkerRun.delivery.turnId && message.author === "assistant",
        )
    : null;
  pass(
    "A quiet script run whose only step is routine_no_update keeps no steps row",
    quietMarkerRun.run.status === "succeeded" && quietMarkerRows !== null && quietMarkerRows.length === 0,
    { run: quietMarkerRun.run, rows: quietMarkerRows },
  );
  const routineTurns = (turnId: string | null) =>
    events.filter((event) => event.type === "thread-turn-completed" && event.routine && event.turn.turnId === turnId);
  const routineThread = (routineId: string) =>
    agents.listTasks(checker.id).tasks.find((task) => task.routineId === routineId);
  const failedTurns = routineTurns(quietFailedRun.delivery.turnId);
  const failedThread = routineThread(quietFailed.id);
  pass(
    "A run in a routine thread sends one routine thread-turn-completed, and a quiet run sends none",
    failedTurns.length === 1 &&
      failedTurns[0]?.type === "thread-turn-completed" &&
      failedTurns[0].taskId === failedThread?.id &&
      failedTurns[0].turn.threadId === failedThread?.threadId &&
      routineTurns(quietOkRun.delivery.turnId).length === 0 &&
      !events.some((event) => event.type === "turn-completed" && event.turnId === quietFailedRun.delivery.turnId),
    { failedTurns, failedThread },
  );
  const sideTask = await runCauseEffect(agents.startTask({ agentId: checker.id, text: "Hello from a side thread." }));
  const sideTurn = await waitFor("the side thread turn", () =>
    events.find((event) => event.type === "thread-turn-completed" && event.taskId === sideTask.id),
  );
  pass(
    "A turn in a side thread of a person sends one thread-turn-completed that is not a routine's",
    sideTurn.type === "thread-turn-completed" &&
      !sideTurn.routine &&
      sideTurn.turn.threadId === sideTask.threadId &&
      sideTurn.turn.status === "completed" &&
      events.filter((event) => event.type === "thread-turn-completed" && event.taskId === sideTask.id).length === 1 &&
      !events.some((event) => event.type === "turn-completed" && event.threadId === sideTask.threadId),
    { sideTurn, sideTask },
  );
  const scriptPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === quietFailedRun.delivery.turnId,
  )?.text;
  pass("The script-run prompt names the tool", scriptPrompt?.includes("call the routine_report_failure tool") === true);
  pass(
    "A script run may pause only its own routine, and a Test run may not change routines (#8963)",
    scriptPrompt?.includes(`routineId "${quietFailed.id}" and active false`) === true &&
      !scriptPrompt.includes("Do not create, update, delete, or test routines") &&
      healthPrompt?.includes(`routineId "${health.id}"`) === false,
    scriptPrompt,
  );
  const userStopLine = "A stop that the user asked for is not a failure.";
  pass(
    "The Test-run and script-run prompts do not say to skip the task when the routine is paused (#11578)",
    scriptPrompt?.includes(userStopLine) === false && healthPrompt?.includes(userStopLine) === false,
    { scriptPrompt, healthPrompt },
  );

  const healthSteps = await steps("Health check", healthRun.run.id, 2);
  const healthOwner = healthSteps.find((step) => step.agentId === checker.id);
  pass(
    "The owner step of a failed run fails with the reason",
    healthOwner?.status === "failed" && healthOwner.error === healthRun.run.error,
    report.flowSteps["Health check"],
  );
  pass(
    "The agent after a failed owner step is skipped",
    healthSteps.find((step) => step.agentId === responder.id)?.status === "skipped",
    report.flowSteps["Health check"],
  );

  const relayedRun = await settledRun(
    "Mirror check",
    await runCauseEffect(agents.testRoutine({ agentId: relay.id, routineId: relayed.id })),
  );
  const relayedSteps = await steps("Mirror check", relayedRun.run.id, 3);
  const linked = relayedSteps.find((step) => step.agentId === responder.id);
  pass(
    "A linked step that calls the tool fails with the reason",
    linked?.status === "failed" && linked.error === LINK_REASON,
    report.flowSteps["Mirror check"],
  );
  const linkedDelivery = linked?.deliveryId ? mailbox.getDelivery(linked.deliveryId)?.delivery : undefined;
  pass(
    "The handoff delivery stays completed",
    linkedDelivery?.status === "completed" && linkedDelivery.error === LINK_REASON,
  );
  pass(
    "The agent after a failed linked step is skipped",
    relayedSteps.find((step) => step.agentId === finisher.id)?.status === "skipped",
    report.flowSteps["Mirror check"],
  );
  const relayedAfter = agents
    .listRoutineRuns({ agentId: relay.id, routineId: relayed.id })
    .find((run) => run.id === relayedRun.run.id);
  pass("A linked step's call does not change the owner's run", relayedAfter?.status === "succeeded");
  const linkedPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === linkedDelivery?.turnId,
  )?.text;
  pass(
    "A linked step's agent may not change the routine of another agent (#8963)",
    linkedPrompt?.includes("Do not create, update, delete, or test routines during this run.") === true &&
      !linkedPrompt.includes(`routineId "${relayed.id}"`),
    linkedPrompt,
  );
  pass(
    "A linked step of a Test run reads as a Test run",
    linkedPrompt?.includes("Run type: manual Test run") === true,
    linkedPrompt,
  );

  const quietRelay = createRoutine(
    relay.id,
    "Quiet relay",
    `Report and hand on. <<NEXT${JSON.stringify([noUpdate])}NEXT>>`,
  );
  await connect(quietRelay.id, relay.id, responder.id);
  await connect(quietRelay.id, responder.id, finisher.id);
  await runCauseEffect(agents.updateAgent({ agentId: relay.id, allowAutomation: true }));
  const quietRelayRun = await settledRun(
    "Quiet relay",
    await runCauseEffect(agents.runRoutineFromAutomation({ agentId: relay.id, routineId: quietRelay.id, payload: "" })),
  );
  const quietRelaySteps = await steps("Quiet relay", quietRelayRun.run.id, 3);
  const quietLinked = quietRelaySteps.find((step) => step.agentId === responder.id);
  const quietLinkedTurnId = quietLinked?.deliveryId
    ? (mailbox.getDelivery(quietLinked.deliveryId)?.delivery.turnId ?? null)
    : null;
  const quietLinkedResult = toolResults(quietLinkedTurnId, "routine_no_update")[0]?.result;
  const quietLinkedAnswers = quietLinkedTurnId
    ? store.database.readTurnAssistantMessages(responder.id, quietLinkedTurnId)
    : [];
  pass(
    "A linked step of a script run ends quiet after routine_no_update (#14510)",
    quietLinked?.status === "succeeded" &&
      quietLinkedResult?.success === true &&
      quietLinkedResult.contentItems.some((item) => item.text.includes('"quiet"')) &&
      quietLinkedAnswers.length > 0 &&
      quietLinkedAnswers.every((message) => message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE),
    { steps: report.flowSteps["Quiet relay"], quietLinkedResult, quietLinkedAnswers },
  );
  pass(
    "The agent after a quiet linked step is skipped",
    quietRelaySteps.find((step) => step.agentId === finisher.id)?.status === "skipped",
    report.flowSteps["Quiet relay"],
  );

  const selfPausing = async (name: string, routineCalls: (routineId: string) => FakeCall[]) => {
    const routine = createRoutine(checker.id, name, "Check the folders.");
    agents.updateRoutine({
      agentId: checker.id,
      routineId: routine.id,
      instruction: `Check the folders. ${calls(...routineCalls(routine.id))}`,
      active: true,
    });
    const ran = await settledRun(
      name,
      await runCauseEffect(
        agents.runRoutineFromAutomation({ agentId: checker.id, routineId: routine.id, payload: "" }),
      ),
    );
    const active = agents.listRoutines(checker.id).find((entry) => entry.id === routine.id)?.active;
    return { ran, active, turnId: ran.delivery.turnId };
  };
  const stopped = await selfPausing("Stops when done", (id) => [pauseRoutine(id)]);
  pass(
    "A run that pauses its own routine and does not fail keeps the routine paused (#8963)",
    stopped.active === false && stopped.ran.run.status === "succeeded",
    { active: stopped.active, run: stopped.ran.run.status },
  );
  const stoppedId = stopped.ran.run.routineId;
  const pausedBy = (list: readonly { id: string; pausedByRun?: { scheduledFor: string } }[]) =>
    list.find((entry) => entry.id === stoppedId)?.pausedByRun?.scheduledFor;
  const reasons = {
    routine: pausedBy(agents.listRoutines(checker.id)),
    record: pausedBy(agents.routineRecords.list({ kind: "agent", id: checker.id })),
    restarted: pausedBy(new AgentRoutineStore(store.database).list(checker.id)),
    run: stopped.ran.run.scheduledFor,
  };
  report.pauseReasons = reasons;
  pass(
    "A routine that its own run paused names that run in both routine lists and after a restart (#10048)",
    reasons.routine === reasons.run && reasons.record === reasons.run && reasons.restarted === reasons.run,
    reasons,
  );
  agents.updateRoutine({ agentId: checker.id, routineId: stoppedId, active: true });
  agents.updateRoutine({ agentId: checker.id, routineId: stoppedId, active: false });
  const userPaused = pausedBy(agents.listRoutines(checker.id));
  pass("A person's resume and pause clear the run that paused the routine (#10048)", userPaused === undefined, {
    userPaused,
  });
  const pausedThenFailed = await selfPausing("Paused then failed", (id) => [pauseRoutine(id), reportFailure(REASON)]);
  const resumedResult = toolResults(pausedThenFailed.turnId, "routine_report_failure")[0]?.result;
  const pausedThenFailedReason = agents
    .listRoutines(checker.id)
    .find((entry) => entry.id === pausedThenFailed.ran.run.routineId)?.pausedByRun;
  pass(
    "A run that pauses its own routine and then reports a failure turns the routine on again (#9856)",
    pausedThenFailedReason === undefined &&
      pausedThenFailed.active === true &&
      pausedThenFailed.ran.run.status === "failed" &&
      resumedResult?.contentItems.some((item) => item.text.includes("the routine is on again")) === true,
    { active: pausedThenFailed.active, run: pausedThenFailed.ran.run.status, resumedResult },
  );
  const failedThenPaused = await selfPausing("Failed then paused", (id) => [reportFailure(REASON), pauseRoutine(id)]);
  const refusedPause = toolResults(failedThenPaused.turnId, "update_routine")[0]?.result;
  pass(
    "A run that reported a failure cannot pause its own routine (#9856)",
    failedThenPaused.active === true &&
      failedThenPaused.ran.run.status === "failed" &&
      refusedPause?.success === false &&
      refusedPause.contentItems.some((item) => item.text.includes("not a stop condition")),
    { active: failedThenPaused.active, run: failedThenPaused.ran.run.status, refusedPause },
  );
  const stopPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === stopped.turnId,
  )?.text;
  pass(
    "The run prompt says that a failure is not a stop condition (#9856)",
    stopPrompt?.includes("is not a stop condition: keep this routine on") === true,
    stopPrompt,
  );
  const pausedThenQuiet = await selfPausing("Paused then quiet", (id) => [pauseRoutine(id), noUpdate]);
  const quietResumedResult = toolResults(pausedThenQuiet.turnId, "routine_no_update")[0]?.result;
  pass(
    "A run that pauses its own routine and then has nothing to report turns the routine on again, and does not end quiet (#14038)",
    pausedThenQuiet.active === true &&
      pausedThenQuiet.ran.run.status === "succeeded" &&
      quietResumedResult?.success === false &&
      quietResumedResult.contentItems.some((item) => item.text.includes("this routine is on again")),
    { active: pausedThenQuiet.active, run: pausedThenQuiet.ran.run.status, quietResumedResult },
  );
  const stopsWithReport = await selfPausing("Stops with a report", (id) => [
    pauseRoutine(id),
    noUpdate,
    pauseRoutine(id),
  ]);
  const secondPause = toolResults(stopsWithReport.turnId, "update_routine")[1]?.result;
  pass(
    "A run that pauses its own routine again after the refused quiet end stops the routine (#14038)",
    stopsWithReport.active === false && stopsWithReport.ran.run.status === "succeeded" && secondPause?.success === true,
    { active: stopsWithReport.active, run: stopsWithReport.ran.run.status, secondPause },
  );
  const quietThenPaused = await selfPausing("Quiet then paused", (id) => [noUpdate, pauseRoutine(id)]);
  const refusedQuietPause = toolResults(quietThenPaused.turnId, "update_routine")[0]?.result;
  pass(
    "A run that ended with nothing to report cannot pause its own routine (#14038)",
    quietThenPaused.active === true &&
      quietThenPaused.ran.run.status === "succeeded" &&
      refusedQuietPause?.success === false &&
      refusedQuietPause.contentItems.some((item) => item.text.includes("not a stop condition")),
    { active: quietThenPaused.active, run: quietThenPaused.ran.run.status, refusedQuietPause },
  );
  pass(
    "The run prompt says that nothing to report is not a stop condition (#14038)",
    stopPrompt?.includes(
      "Nothing to report is not a stop condition either: keep this routine on. A run that pauses this routine must say so in a short report",
    ) === true,
    stopPrompt,
  );
  for (const name of [
    "Paused then failed",
    "Failed then paused",
    "Paused then quiet",
    "Stops with a report",
    "Quiet then paused",
  ]) {
    const routine = agents.listRoutines(checker.id).find((entry) => entry.name === name);
    if (routine) agents.updateRoutine({ agentId: checker.id, routineId: routine.id, active: false });
  }

  const askAndStayQuiet = (word: string) =>
    `Ask ${finisher.name}. ${calls({
      tool: "send_message",
      arguments: { recipientAgentIds: [finisher.id], text: `Is the mirror up? ${word}` },
    })} Then send no message. ${replyCalls(noUpdate)}`;
  const quietAsk = createRoutine(checker.id, "Quiet ask", askAndStayQuiet("QUIET-ASK"));
  const shownAsk = createRoutine(checker.id, "Shown ask", askAndStayQuiet("SHOWN-ASK"));
  const answerTurn = (routineName: string) =>
    waitFor(`the answer turn of ${routineName}`, () => {
      const turn = fakeEntries().find(
        (entry) =>
          entry.method === "turn/start" &&
          entry.text?.includes("This replies to message:") === true &&
          entry.text.includes(`in a run of your routine "${routineName}"`),
      );
      const messageId = /Message ID: (\S+)/.exec(turn?.text ?? "")?.[1];
      const delivery = messageId ? mailbox.deliveryForMessage(messageId, checker.id)?.delivery : undefined;
      return turn && ended(delivery?.status) ? turn.turnId : null;
    });
  await settledRun(
    "Quiet ask",
    await runCauseEffect(agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietAsk.id, payload: "" })),
  );
  const quietAnswerTurnId = await answerTurn("Quiet ask");
  const quietAnswerResult = toolResults(quietAnswerTurnId, "routine_no_update")[0]?.result;
  const answerEvents = (turnId: string) =>
    events.filter(
      (event) =>
        (event.type === "thread-turn-completed" && event.turn.turnId === turnId) ||
        (event.type === "turn-completed" && event.turnId === turnId && !event.quiet),
    );
  const quietAnswers = store.database.readTurnAssistantMessages(checker.id, quietAnswerTurnId);
  pass(
    "A teammate's answer to a request of a quiet run ends quiet after routine_no_update",
    quietAnswerResult?.success === true &&
      quietAnswerResult.contentItems.some((item) => item.text.includes('"quiet"')) &&
      answerEvents(quietAnswerTurnId).length === 0 &&
      quietAnswers.length > 0 &&
      quietAnswers.every((message) => message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE),
    { quietAnswerResult, quietAnswers },
  );
  await settledRun(
    "Shown ask",
    await runCauseEffect(agents.testRoutine({ agentId: checker.id, routineId: shownAsk.id })),
  );
  const shownAnswerTurnId = await answerTurn("Shown ask");
  const shownAnswerResult = toolResults(shownAnswerTurnId, "routine_no_update")[0]?.result;
  const testAnswers = store.database.readTurnAssistantMessages(checker.id, shownAnswerTurnId);
  pass(
    "A teammate's answer to a request of a Test run shows, and routine_no_update is refused",
    shownAnswerResult?.success === false &&
      testAnswers.length > 0 &&
      testAnswers.every((message) => message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE) &&
      answerEvents(shownAnswerTurnId).length === 1,
    { shownAnswerResult, testAnswers },
  );

  const pending = results.runsWithoutDelivery(since).map((run) => run.runId);
  report.resultRuns = pending;
  pass("A result destination gets a reported failure", pending.includes(healthRun.run.id));
  pass("A result destination still gets a succeeded run", pending.includes(plainRun.run.id));
  pass("A result destination gets nothing for a provider failure", !pending.includes(brokenRun.run.id));
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await Effect.runPromise(flows.close()).catch(() => {});
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
