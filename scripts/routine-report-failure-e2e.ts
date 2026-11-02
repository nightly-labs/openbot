// Checks `routine_report_failure` (#2804): an agent marks its routine run failed when the task could
// not be done. Runs the real agent service, tool router, routine flows and routine result store on a
// temporary profile with a fake Codex app-server. The fake calls the OpenBot tools that a turn's input
// names in `<<CALLS[...]CALLS>>`, logs each result, and then answers. The check asserts that a called
// run ends `failed` with the redacted reason while its delivery stays `completed` and its answer shows,
// that a later queue change keeps it failed, that a run with no call succeeds, that a provider failure
// still wins, that a failed script run is never quiet, that the tool fails outside a routine run, that
// a flow skips the agents after a failed owner or linked step, and that a result destination gets the
// answer of a reported failure but not of a provider failure.
// `bun scripts/routine-report-failure-e2e.ts`. Writes .openbot-build/routine-report-failure-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  latestTurnAnswer,
  type RoutineRun,
  routineRunConversationEvent,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-report-failure-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-failure-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
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
const LINK_REASON = "The mirror is down.";

/** A tool call that the fake makes. */
interface FakeCall {
  tool: "routine_report_failure" | "routine_no_update";
  arguments: { reason?: string };
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;
const reportFailure = (reason: string): FakeCall => ({ tool: "routine_report_failure", arguments: { reason } });
const noUpdate: FakeCall = { tool: "routine_no_update", arguments: {} };

/**
 * A Codex app-server with the methods that the service calls. A turn calls, one at a time, the
 * OpenBot tools that its input (the task, for a routine prompt) names in `<<CALLS[...]CALLS>>`, logs each
 * result, then answers:
 * `FAILED_ANSWER` after a call, `Relay report <<CALLS...CALLS>>` for an input with `<<NEXT...NEXT>>`
 * (so the next agent of a flow gets the calls), and "All good." otherwise. An input with
 * `PROVIDER-FAIL` ends the turn failed with an error and no answer.
 */
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
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
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
  const item = { type: "agentMessage", id: "message-" + turnId, text: turn.reply, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const callNext = (turn) => {
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
      // Only the task of a routine prompt: the prompt can quote earlier chat messages before it.
      const start = text.lastIndexOf("--- routine task ---");
      const task = start >= 0 ? text.slice(start) : text;
      const named = /<<CALLS([\\s\\S]*?)CALLS>>/.exec(task);
      const next = /<<NEXT([\\s\\S]*?)NEXT>>/.exec(task);
      const turnCalls = named ? JSON.parse(named[1]) : [];
      const reply = next ? "Relay report <<CALLS" + next[1] + "CALLS>>" : turnCalls.length ? ${JSON.stringify(FAILED_ANSWER)} : "All good.";
      return callNext({ threadId: params.threadId, turnId, calls: turnCalls, reply, providerFail: task.includes("PROVIDER-FAIL") });
    }
    case "turn/interrupt": {
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
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { runs: {}, flowSteps: {}, resultRuns: [], checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
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

/** Waits for a state of the service, its database or the fake's log. */
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
const turnAnswer = (agentId: string, turnId: string): string | null => {
  const threadId = store.list().find((agent) => agent.id === agentId)?.threadId;
  if (!threadId) return null;
  return latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, threadId, turnId), turnId)?.text ?? null;
};
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
  });
}

/** Waits for a run's delivery and run to end, and records both. */
async function settledRun(name: string, run: RoutineRun) {
  const deliveryId = run.deliveryId;
  assert.ok(deliveryId, `${name}: no delivery`);
  const delivery = await waitFor(`${name} delivery`, () => {
    const found = mailbox.getDelivery(deliveryId)?.delivery;
    return ended(found?.status) ? found : null;
  });
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

function turnCompleted(turnId: string | null) {
  return events.find(
    (event): event is Extract<AgentEvent, { type: "turn-completed" }> =>
      event.type === "turn-completed" && event.turnId === turnId,
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

  const health = createRoutine(checker.id, "Health check", `Check the server. ${calls(reportFailure(REASON))}`);
  const plain = createRoutine(checker.id, "Plain check", "Check the build.");
  const broken = createRoutine(checker.id, "Broken check", "Check the disk. PROVIDER-FAIL");
  const quietFailed = createRoutine(
    checker.id,
    "Quiet failed",
    `Check quietly. ${calls(noUpdate, reportFailure(REASON))}`,
  );
  const quietOk = createRoutine(checker.id, "Quiet ok", `Check quietly. ${calls(noUpdate)}`);
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
  // A connection row only: the result service that would post to it does not run here.
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

  // Outside a routine run, the tool fails as `routine_no_update` does.
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

  // A Test run that reports a failure.
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
  pass("The run's answer shows in the chat", turnAnswer(checker.id, healthRun.delivery.turnId ?? "") === FAILED_ANSWER);
  pass("A Test-run turn completes as usual", turnCompleted(healthRun.delivery.turnId)?.status === "completed");
  const healthPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === healthRun.delivery.turnId,
  )?.text;
  pass("The Test-run prompt names the tool", healthPrompt?.includes("call the routine_report_failure tool") === true);
  const healthTransitions = (await runCauseEffect(agents.readConversation(checker.id))).messages
    .map(routineRunConversationEvent)
    .filter((event) => event?.runId === healthRun.run.id)
    .map((event) => event?.status);
  pass(
    "The run goes from running to failed, never through succeeded",
    healthTransitions.includes("failed") && !healthTransitions.includes("succeeded"),
    healthTransitions,
  );

  // A routine run with no call, and a provider failure.
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

  // A later queue change reconciles every delivery of the queue again.
  const laterReceipt = await runCauseEffect(agents.sendMessage({ agentId: checker.id, text: "Anything else?" }));
  const laterId = laterReceipt.deliveries[0]?.id;
  assert.ok(laterId);
  await waitFor("the later chat turn", () => ended(mailbox.getDelivery(laterId)?.delivery.status));
  const healthAfter = agents
    .listRoutineRuns({ agentId: checker.id, routineId: health.id })
    .find((run) => run.id === healthRun.run.id);
  pass(
    "A later queue change keeps the run failed",
    healthAfter?.status === "failed" && healthAfter.error === healthRun.run.error,
  );

  // Script runs: a reported failure is never quiet, also after `routine_no_update`.
  await runCauseEffect(agents.updateAgent({ agentId: checker.id, allowAutomation: true }));
  const quietOkRun = await settledRun(
    "Quiet ok",
    await runCauseEffect(agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietOk.id, payload: "" })),
  );
  pass(
    "A script run with only routine_no_update is quiet",
    quietOkRun.run.status === "succeeded" && turnCompleted(quietOkRun.delivery.turnId)?.quiet === true,
  );
  const quietFailedRun = await settledRun(
    "Quiet failed",
    await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: checker.id, routineId: quietFailed.id, payload: "" }),
    ),
  );
  pass(
    "A failed script run is not quiet, also after routine_no_update",
    quietFailedRun.run.status === "failed" &&
      turnCompleted(quietFailedRun.delivery.turnId) !== undefined &&
      turnCompleted(quietFailedRun.delivery.turnId)?.quiet !== true,
    turnCompleted(quietFailedRun.delivery.turnId),
  );
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
      failedThenQuietRun.run.status === "failed" &&
      turnCompleted(failedThenQuietRun.delivery.turnId)?.quiet !== true,
    noUpdateAfterFailure,
  );
  const scriptPrompt = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.turnId === quietFailedRun.delivery.turnId,
  )?.text;
  pass("The script-run prompt names the tool", scriptPrompt?.includes("call the routine_report_failure tool") === true);

  // Flows: a failed owner step skips the next agent.
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

  // Flows: a call in a linked step fails that step only.
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

  // Result destinations: the answer of a reported failure goes; a provider failure has none.
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
