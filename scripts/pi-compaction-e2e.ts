// Checks that a compaction Pi runs by itself reaches OpenBot as `openbot/context-compaction`, sets
// the growth guard from `estimatedTokensAfter`, and does not trigger a second compaction at the same
// fill. A manual compaction stays OpenBot's own. Also covers the usage regression paths.
// `bun scripts/pi-compaction-e2e.ts`. Writes .openbot-build/pi-compaction-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, decodeUsageTokens, type UsageTokens } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getRecord, getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-compaction-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pi-compaction-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const agentDirectory = join(home, ".pi", "agent");
const fakePi = join(root, "pi");
const fakeLog = join(root, "pi.jsonl");

// Before the service modules load: the Pi process and the stores read the home folder.
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.OPENBOT_PI_PATH = fakePi;
process.env.FAKE_PI_LOG = fakeLog;
mkdirSync(agentDirectory, { recursive: true });
writeFileSync(join(agentDirectory, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");
const { PiAgentClient } = await import("../src/backend/pi-client");

/**
 * A Pi RPC host with the commands the service calls. The prompt text selects the stats and the
 * compaction event. Each process is one provider session, so a pid-based file keeps agents apart.
 */
const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  process.stdout.write("1.4.0\\n");
  process.exit(0);
}
const log = process.env.FAKE_PI_LOG;
let sessionFile = path.join(process.env.PI_CODING_AGENT_DIR, "session-" + process.pid + ".jsonl");
let contextUsage = { tokens: 50000, contextWindow: 200000, percent: 25 };
let contextField = "present";
let statsTimeout = false;
let compaction = null;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const sendCompaction = (value) => {
  send({ type: "compaction_start", reason: value.reason });
  if (value.aborted) {
    send({ type: "compaction_end", reason: value.reason, aborted: true });
    return;
  }
  if (value.failed) {
    send({
      type: "compaction_end",
      reason: value.reason,
      aborted: false,
      errorMessage: "The fake summary failed.",
      willRetry: false,
    });
    return;
  }
  send({
    type: "compaction_end",
    reason: value.reason,
    aborted: false,
    willRetry: false,
    result: {
      summary: "The fake summary.",
      firstKeptEntryId: "fake-entry",
      tokensBefore: 165000,
      estimatedTokensAfter: value.afterTokens,
      details: {},
    },
  });
};
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
  switch (message.type) {
    case "get_state": return reply({ sessionFile, thinkingLevel: "off" });
    case "switch_session": {
      sessionFile = String(message.sessionPath || sessionFile);
      return reply({});
    }
    case "get_available_models": return reply({ models: [{ provider: "openai", id: "gpt-fake", name: "GPT Fake" }] });
    case "get_available_thinking_levels": return reply({ levels: ["off"] });
    case "set_model":
    case "set_thinking_level": return reply({});
    case "prompt": {
      const text = String(message.message || "");
      fs.appendFileSync(log, JSON.stringify({ type: "prompt", text }) + "\\n");
      statsTimeout = text.includes("timeout");
      contextField = "present";
      compaction = null;
      if (text.includes("no-context")) contextField = "omit";
      else if (text.includes("initial-threshold-grown")) {
        contextUsage = { tokens: 171000, contextWindow: 200000, percent: 85.5 };
      } else if (text.includes("initial-threshold-guard")) {
        contextUsage = { tokens: 165000, contextWindow: 200000, percent: 82.5 };
        compaction = { reason: "threshold", afterTokens: 160000 };
      } else if (text.includes("threshold-low")) {
        contextUsage = { tokens: 32000, contextWindow: 200000, percent: 16 };
        compaction = { reason: "threshold", afterTokens: 32000 };
      } else if (text.includes("threshold-guard")) {
        contextUsage = { tokens: 165000, contextWindow: 200000, percent: 82.5 };
        compaction = { reason: "threshold", afterTokens: 160000 };
      } else if (text.includes("threshold-grown")) {
        contextUsage = { tokens: 171000, contextWindow: 200000, percent: 85.5 };
      } else if (text.includes("native-aborted-low")) {
        contextUsage = { tokens: 50000, contextWindow: 200000, percent: 25 };
        compaction = { reason: "threshold", aborted: true };
      } else if (text.includes("native-failed-low")) {
        contextUsage = { tokens: 50000, contextWindow: 200000, percent: 25 };
        compaction = { reason: "overflow", failed: true };
      } else if (text.includes("overflow-guard")) {
        contextUsage = { tokens: 165000, contextWindow: 200000, percent: 82.5 };
        compaction = { reason: "overflow", afterTokens: 160000 };
      } else if (text.includes("native-aborted")) {
        contextUsage = { tokens: 165000, contextWindow: 200000, percent: 82.5 };
        compaction = { reason: "threshold", aborted: true };
      } else if (text.includes("native-failed")) {
        contextUsage = { tokens: 165000, contextWindow: 200000, percent: 82.5 };
        compaction = { reason: "overflow", failed: true };
      } else if (text.includes("native-manual")) {
        contextUsage = { tokens: 50000, contextWindow: 200000, percent: 25 };
        compaction = { reason: "manual", afterTokens: 32000 };
      } else {
        contextUsage = { tokens: 50000, contextWindow: 200000, percent: 25 };
      }
      if (compaction) sendCompaction(compaction);
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop" } });
      return reply({ disposition: "handled" });
    }
    case "get_session_stats":
      if (statsTimeout) return;
      return reply({
        sessionFile,
        sessionId: "fake-session",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 50000, output: 10000, cacheRead: 40000, cacheWrite: 5000, total: 105000 },
        cost: 0.45,
        ...(contextField === "omit" ? {} : { contextUsage }),
      });
    case "compact":
      fs.appendFileSync(log, JSON.stringify({ type: "compact", at: Date.now() }) + "\\n");
      return reply({});
    case "abort":
    case "clear_queue": return reply({});
    default: return reply({});
  }
});
`;

interface CapturedNotification {
  method: string;
  params?: unknown;
}

interface UsageRecord {
  agentId: string;
  threadId: string;
  turnId: string;
  model: string;
  tokens: UsageTokens;
}

interface ContextNotification {
  totalTokens: number | null;
  modelContextWindow: number | null;
  estimated: boolean;
}

interface NativeEvent {
  status: string;
  afterTokens: number | null;
}

interface CaseReport {
  name: string;
  turnId: string;
  usageEvents: number;
  contextEvents: number;
  recordCount: number;
  nativeRunning: number;
  nativeCompleted: number;
  nativeFailed: number;
  afterTokens: number | null;
  contextStatus: string | null;
  compactRequests: number;
  passed: boolean;
}

interface CaseExpectation {
  usageEvents: number;
  contextEvents: number;
  records: number;
  nativeRunning: number;
  nativeCompleted: number;
  nativeFailed: number;
  afterTokens?: number | null;
  context?: ContextNotification;
}

interface FakeLogEntry {
  type: string;
  text?: string;
}

const report: {
  cases: CaseReport[];
  context?: { usedTokens: number; windowTokens: number; autoCompactAt: number | null } | null;
  compactRequests: number;
  passed: boolean;
  error?: string;
} = { cases: [], compactRequests: 0, passed: false };

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

/** Waits for a state of the service or of its database. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(fakePi, FAKE_PI, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const piDriver = BUILT_IN_PROVIDER_DRIVERS.find((driver) => driver.id === "pi");
assert.ok(piDriver, "The Pi driver is registered.");
const notifications: CapturedNotification[] = [];
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "pi",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "pi"),
  clientFactory: (provider, cli, confinement) => {
    assert.equal(provider, "pi", "Only Pi runs in this check.");
    const client = piDriver.createClient(cli, 5_000, NO_PROVIDER_CREDENTIALS, confinement);
    assert.ok(client instanceof PiAgentClient, "The Pi client is used.");
    client.on("notification", (notification) => notifications.push(notification));
    return client;
  },
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

function records(turnId: string): UsageRecord[] {
  return sqlite()
    .prepare(
      `SELECT r.agent_id, s.thread_id, r.turn_id, r.model, r.tokens_json, r.rate_basis
       FROM agent_usage_records r JOIN projection_provider_sessions s ON s.id = r.session_id
       WHERE r.turn_id = ? ORDER BY r.recorded_at, r.rowid`,
    )
    .all(turnId)
    .map((row) => ({
      agentId: String(row.agent_id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      model: String(row.model),
      tokens: decodeUsageTokens(JSON.parse(String(row.tokens_json))),
    }));
}

function turnsOf(threadId: string): string[] {
  return sqlite()
    .prepare(
      `SELECT a.turn_id FROM agent_usage_activity a JOIN projection_provider_sessions s ON s.id = a.session_id
       WHERE a.kind = 'turn' AND s.thread_id = ? ORDER BY a.occurred_at, a.rowid`,
    )
    .all(threadId)
    .map((row) => String(row.turn_id));
}

async function settled(deliveryId: string, label: string) {
  const status = await waitFor(label, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  assert.equal(status, "completed", `${label}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
}

function captured(turnId: string, method: string): DynamicRecord[] {
  return notifications
    .filter((notification) => notification.method === method && getString(notification.params, "turnId") === turnId)
    .map((notification) => {
      const params = getRecord(notification.params, method === "openbot/usage" ? "usage" : "tokenUsage");
      assert.ok(params, `${method} carries its payload.`);
      return params;
    });
}

function numberField(record: unknown, key: string): number | null {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "number" ? value : null;
}

function contextOf(notification: DynamicRecord | null): ContextNotification | null {
  if (!notification) return null;
  return {
    totalTokens: numberField(getRecord(notification, "last"), "totalTokens"),
    modelContextWindow: numberField(notification, "modelContextWindow"),
    estimated: notification.estimated === true,
  };
}

function nativeEvents(turnId: string): NativeEvent[] {
  return notifications
    .filter(
      (notification) =>
        notification.method === "openbot/context-compaction" && getString(notification.params, "turnId") === turnId,
    )
    .map((notification) => ({
      status: getString(notification.params, "status") ?? "",
      afterTokens: numberField(notification.params, "afterTokens"),
    }));
}

function nativeCounts(events: NativeEvent[]): { running: number; completed: number; failed: number } {
  return {
    running: events.filter((event) => event.status === "running").length,
    completed: events.filter((event) => event.status === "completed").length,
    failed: events.filter((event) => event.status === "failed").length,
  };
}

function inspect(
  name: string,
  threadId: string,
  turnId: string,
  agentId: string,
  expected: CaseExpectation,
): CaseReport {
  const usage = captured(turnId, "openbot/usage");
  const context = captured(turnId, "thread/tokenUsage/updated");
  const rows = records(turnId);
  const native = nativeEvents(turnId);
  const counts = nativeCounts(native);
  const completed = native.find((event) => event.status === "completed") ?? null;
  const result: CaseReport = {
    name,
    turnId,
    usageEvents: usage.length,
    contextEvents: context.length,
    recordCount: rows.length,
    nativeRunning: counts.running,
    nativeCompleted: counts.completed,
    nativeFailed: counts.failed,
    afterTokens: completed?.afterTokens ?? null,
    contextStatus: null,
    compactRequests: 0,
    passed: false,
  };
  report.cases.push(result);
  assert.equal(usage.length, expected.usageEvents, `${name}: openbot/usage event count`);
  assert.equal(context.length, expected.contextEvents, `${name}: thread/tokenUsage/updated event count`);
  assert.equal(rows.length, expected.records, `${name}: usage record count`);
  assert.deepEqual(
    counts,
    { running: expected.nativeRunning, completed: expected.nativeCompleted, failed: expected.nativeFailed },
    `${name}: native compaction event counts`,
  );
  if (expected.afterTokens !== undefined)
    assert.equal(result.afterTokens, expected.afterTokens, `${name}: estimatedTokensAfter`);
  if (expected.context !== undefined) {
    assert.ok(context[0], `${name}: context fill was sent`);
    assert.deepEqual(contextOf(context[0]), expected.context, `${name}: context fill payload`);
  }
  for (const record of rows) {
    assert.equal(record.agentId, agentId, `${name}: the record belongs to the agent`);
    assert.equal(record.threadId, threadId, `${name}: the record belongs to the turn's thread`);
  }
  result.passed = true;
  return result;
}

async function sendTurn(agentId: string, threadId: string, text: string): Promise<string> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${text}: the message was delivered`);
  await settled(deliveryId, text);
  const turnId = turnsOf(threadId).at(-1);
  assert.ok(turnId, `${text}: the turn was recorded`);
  return turnId;
}

async function warmup(agentId: string, threadId: string): Promise<void> {
  await sendTurn(agentId, threadId, "warmup");
}

function readLog(): string {
  try {
    return readFileSync(fakeLog, "utf8");
  } catch {
    return "";
  }
}

function fakeLogEntry(line: string): FakeLogEntry {
  const value = JSON.parse(line);
  assert.ok(isRecord(value) && isString(value.type), "The fake Pi log entry has a type.");
  return { type: value.type, ...(isString(value.text) ? { text: value.text } : {}) };
}

function fakeLogEntries(): FakeLogEntry[] {
  return readLog().split("\n").filter(Boolean).map(fakeLogEntry);
}

function compactCount(): number {
  return fakeLogEntries().filter((entry) => entry.type === "compact").length;
}

async function waitForCompact(count: number, label: string): Promise<number> {
  return waitFor(
    label,
    () => {
      const current = compactCount();
      return current >= count ? current : null;
    },
    20_000,
  );
}

function compactBetweenPrompts(first: string, second: string): number {
  const entries = fakeLogEntries();
  const start = entries.findIndex((entry) => entry.type === "prompt" && entry.text === first);
  const end = entries.findIndex((entry, index) => index > start && entry.type === "prompt" && entry.text === second);
  assert.ok(start >= 0, `The log has the ${first} prompt.`);
  assert.ok(end > start, `The log has the ${second} prompt after ${first}.`);
  return entries.slice(start + 1, end).filter((entry) => entry.type === "compact").length;
}

function contextStatus(agentId: string): string | null | undefined {
  return agents.getRuntimeSnapshot().contextStates?.find((state) => state.agentId === agentId)?.compaction?.status;
}

async function waitForCompaction(agentId: string, status: "completed" | "failed"): Promise<void> {
  await waitFor(`the compaction to be ${status}`, () => contextStatus(agentId) === status, 20_000);
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Pi Compaction",
      description: "Checks Pi native compaction.",
      avatarSeed: "pi-compaction",
      avatarHue: null,
      initialMessage: "warmup",
    }),
  );
  assert.match(agent.model, /^openai\//, "The check runs the fake Pi model.");
  const chatThread = await waitFor(
    "the agent's own thread",
    () => store.list().find((entry) => entry.id === agent.id)?.threadId,
  );
  await waitFor("the warmup turn to report usage", () => turnsOf(chatThread)[0] ?? null);
  await waitFor("the warmup turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );

  let totalCompact = compactCount();
  assert.equal(totalCompact, 0, "The warmup did not compact.");

  const lowTurn = await sendTurn(agent.id, chatThread, "threshold-low");
  const low = inspect("native threshold at 32000", chatThread, lowTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 1,
    nativeFailed: 0,
    afterTokens: 32000,
    context: { totalTokens: 32000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(agent.id), "completed", "The native compaction is completed in the snapshot.");
  low.contextStatus = "completed";
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "The low native compaction did not start OpenBot's own.");

  const guardTurn = await sendTurn(agent.id, chatThread, "threshold-guard");
  const guard = inspect("native threshold at 160000", chatThread, guardTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 1,
    nativeFailed: 0,
    afterTokens: 160000,
    context: { totalTokens: 165000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(agent.id), "completed", "The guard compaction is completed in the snapshot.");
  guard.contextStatus = "completed";

  const grownTurn = await sendTurn(agent.id, chatThread, "threshold-grown");
  const grown = inspect("grown fill after the guard", chatThread, grownTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 0,
    nativeCompleted: 0,
    nativeFailed: 0,
    afterTokens: null,
    context: { totalTokens: 171000, modelContextWindow: 200000, estimated: true },
  });
  await waitForCompact(1, "the grown fill to compact");
  assert.equal(compactCount(), 1, "Only the grown fill asked OpenBot to compact.");
  assert.equal(
    compactBetweenPrompts("threshold-guard", "threshold-grown"),
    0,
    "The guard turn did not compact before the grown turn.",
  );
  await waitForCompaction(agent.id, "completed");
  grown.contextStatus = "completed";
  const grownState = agents.getRuntimeSnapshot().contextStates?.find((entry) => entry.agentId === agent.id);
  report.context = grownState?.usage
    ? {
        usedTokens: grownState.usage.usedTokens,
        windowTokens: grownState.usage.windowTokens,
        autoCompactAt: grownState.usage.autoCompactAt,
      }
    : null;
  guard.compactRequests = 0;
  grown.compactRequests = 1;
  low.compactRequests = 0;
  await warmup(agent.id, chatThread);
  totalCompact = compactCount();
  assert.equal(totalCompact, 1, "The two native turns and the grown turn left one OpenBot compaction.");

  const overflowTurn = await sendTurn(agent.id, chatThread, "overflow-guard");
  const overflow = inspect("native overflow at 160000", chatThread, overflowTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 1,
    nativeFailed: 0,
    afterTokens: 160000,
    context: { totalTokens: 165000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(agent.id), "completed", "The overflow compaction is completed in the snapshot.");
  overflow.contextStatus = "completed";
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "The overflow guard did not start OpenBot's own.");
  overflow.compactRequests = 0;

  const abortedTurn = await sendTurn(agent.id, chatThread, "native-aborted");
  const aborted = inspect("native aborted", chatThread, abortedTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 0,
    nativeFailed: 1,
    afterTokens: null,
    context: { totalTokens: 165000, modelContextWindow: 200000, estimated: true },
  });
  await waitForCompact(totalCompact + 1, "the aborted turn to compact");
  assert.equal(compactCount(), totalCompact + 1, "The aborted compaction left the budget eligible for OpenBot.");
  await waitForCompaction(agent.id, "completed");
  aborted.compactRequests = 1;
  await warmup(agent.id, chatThread);
  totalCompact = compactCount();
  assert.equal(totalCompact, 2, "The aborted turn added one OpenBot compaction.");

  const failedTurn = await sendTurn(agent.id, chatThread, "native-failed");
  const failed = inspect("native failed", chatThread, failedTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 0,
    nativeFailed: 1,
    afterTokens: null,
    context: { totalTokens: 165000, modelContextWindow: 200000, estimated: true },
  });
  await waitForCompact(totalCompact + 1, "the failed turn to compact");
  assert.equal(compactCount(), totalCompact + 1, "The failed compaction left the budget eligible for OpenBot.");
  await waitForCompaction(agent.id, "completed");
  failed.compactRequests = 1;
  await warmup(agent.id, chatThread);
  totalCompact = compactCount();
  assert.equal(totalCompact, 3, "The failed turn added one OpenBot compaction.");

  const abortedLowTurn = await sendTurn(agent.id, chatThread, "native-aborted-low");
  const abortedLow = inspect("native aborted at low fill", chatThread, abortedLowTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 0,
    nativeFailed: 1,
    afterTokens: null,
    context: { totalTokens: 50000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(agent.id), "failed", "An aborted native compaction is failed in the snapshot.");
  abortedLow.contextStatus = "failed";
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "A low-fill aborted compaction did not compact.");
  abortedLow.compactRequests = 0;

  const failedLowTurn = await sendTurn(agent.id, chatThread, "native-failed-low");
  const failedLow = inspect("native failed at low fill", chatThread, failedLowTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 0,
    nativeFailed: 1,
    afterTokens: null,
    context: { totalTokens: 50000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(agent.id), "failed", "A failed native compaction is failed in the snapshot.");
  failedLow.contextStatus = "failed";
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "A low-fill failed compaction did not compact.");
  failedLow.compactRequests = 0;

  const manualTurn = await sendTurn(agent.id, chatThread, "native-manual");
  const manual = inspect("native manual is not reported", chatThread, manualTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 0,
    nativeCompleted: 0,
    nativeFailed: 0,
    afterTokens: null,
    context: { totalTokens: 50000, modelContextWindow: 200000, estimated: true },
  });
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "The manual compaction was not treated as native.");
  manual.compactRequests = 0;

  const noContextTurn = await sendTurn(agent.id, chatThread, "no-context");
  const noContext = inspect("contextUsage omitted", chatThread, noContextTurn, agent.id, {
    usageEvents: 1,
    contextEvents: 0,
    records: 1,
    nativeRunning: 0,
    nativeCompleted: 0,
    nativeFailed: 0,
    afterTokens: null,
  });
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "A turn without contextUsage did not compact.");
  noContext.compactRequests = 0;

  const timeoutTurn = await sendTurn(agent.id, chatThread, "timeout");
  const timeout = inspect("stats timeout", chatThread, timeoutTurn, agent.id, {
    usageEvents: 0,
    contextEvents: 0,
    records: 0,
    nativeRunning: 0,
    nativeCompleted: 0,
    nativeFailed: 0,
    afterTokens: null,
  });
  await warmup(agent.id, chatThread);
  assert.equal(compactCount(), totalCompact, "The timeout turn did not compact.");
  timeout.compactRequests = 0;

  // A separate agent, with no warmup: Pi compacts on its first turn, before any usage event has
  // created a budget. The pending value must survive until that budget is created.
  const firstTurnBaseline = compactCount();
  const firstTurnAgent = await runCauseEffect(
    agents.createAgent({
      name: "Pi First Compaction",
      description: "Checks a native compaction on the first turn.",
      avatarSeed: "pi-first-compaction",
      avatarHue: null,
      initialMessage: "initial-threshold-guard",
    }),
  );
  assert.match(firstTurnAgent.model, /^openai\//, "The first-turn agent runs the fake Pi model.");
  const firstTurnThread = await waitFor(
    "the first-turn agent's thread",
    () => store.list().find((entry) => entry.id === firstTurnAgent.id)?.threadId,
  );
  const firstTurnId = await waitFor("the first-turn compaction turn", () => turnsOf(firstTurnThread)[0] ?? null);
  await waitFor("the first-turn agent to be idle", () =>
    agents
      .listQueue(firstTurnAgent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  const firstTurnGuard = inspect("first turn native guard", firstTurnThread, firstTurnId, firstTurnAgent.id, {
    usageEvents: 1,
    contextEvents: 1,
    records: 1,
    nativeRunning: 1,
    nativeCompleted: 1,
    nativeFailed: 0,
    afterTokens: 160000,
    context: { totalTokens: 165000, modelContextWindow: 200000, estimated: true },
  });
  assert.equal(contextStatus(firstTurnAgent.id), "completed", "The first-turn compaction is completed.");
  firstTurnGuard.contextStatus = "completed";
  assert.equal(
    compactCount(),
    firstTurnBaseline,
    "A native compaction before the first budget did not ask OpenBot to compact.",
  );

  const firstTurnGrownTurn = await sendTurn(firstTurnAgent.id, firstTurnThread, "initial-threshold-grown");
  const firstTurnGrown = inspect(
    "first turn grown after native guard",
    firstTurnThread,
    firstTurnGrownTurn,
    firstTurnAgent.id,
    {
      usageEvents: 1,
      contextEvents: 1,
      records: 1,
      nativeRunning: 0,
      nativeCompleted: 0,
      nativeFailed: 0,
      afterTokens: null,
      context: { totalTokens: 171000, modelContextWindow: 200000, estimated: true },
    },
  );
  await waitForCompact(firstTurnBaseline + 1, "the first-turn grown fill to compact");
  assert.equal(compactCount(), firstTurnBaseline + 1, "The grown fill after the first budget compacted once.");
  assert.equal(
    compactBetweenPrompts("initial-threshold-guard", "initial-threshold-grown"),
    0,
    "The first-turn guard did not compact before the grown turn.",
  );
  firstTurnGuard.compactRequests = 0;
  firstTurnGrown.compactRequests = 1;

  report.compactRequests = compactCount();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  closeReader();
  database.close();
  report.compactRequests = compactCount();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
