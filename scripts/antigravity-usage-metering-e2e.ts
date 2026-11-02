// Checks that Gemini token usage through Antigravity is metered once per turn, with thinking as
// output. Runs the real agent service on a temporary profile with a fake Antigravity ACP server that
// answers `session/prompt` as Antigravity 1.4.3 does: `usage` holds the tokens of that prompt only
// (`_extract_turn_usage` subtracts the session's total at the turn's start), and `thoughtTokens` is
// apart from `outputTokens`. A message `tokens=<input>,<cached>,<output>,<thought>` sets the usage of
// its turn. Cases: a first turn, a smaller second turn in the same session (the session counter
// before this change booked 0 for it), a larger third turn (it booked only the excess over the
// largest turn), and a turn after the provider process starts again and resumes the session.
// `bun scripts/antigravity-usage-metering-e2e.ts`. Writes
// .openbot-build/antigravity-usage-metering-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, decodeUsageTokens, type UsageTokens } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-usage-metering-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-metering-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "antigravity");
const fakeAgy = join(install, "bin", "agy_acp_server");
const logPath = join(root, "agy.jsonl");

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.FAKE_AGY_LOG = logPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** An Antigravity ACP server with the methods that the service calls. `/usage` has no plan quota. */
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ pid: process.pid, ...entry }) + NL);
log({ start: true });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "gemini-3-pro";
const setup = (sessionId) => ({ sessionId, models: { availableModels: [{ modelId: MODEL, name: "Gemini 3 Pro" }], currentModelId: MODEL } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.method) log({ method: message.method, sessionId: params.sessionId ?? null });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("agy-" + process.pid + "-" + ++sessions) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    const match = /tokens=(\\d+),(\\d+),(\\d+),(\\d+)/.exec(text);
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } } });
    if (!match) return write({ id: message.id, result: { stopReason: "end_turn" } });
    const [input, cached, output, thought] = match.slice(1).map(Number);
    return write({ id: message.id, result: { stopReason: "end_turn", usage: {
      inputTokens: input, outputTokens: output, cachedReadTokens: cached, cachedWriteTokens: 0,
      thoughtTokens: thought, totalTokens: input + output + thought,
    } } });
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface Turn {
  input: number;
  cached: number;
  output: number;
  thought: number;
}

interface CaseReport {
  name: string;
  turnId: string;
  sent: Turn;
  recorded: UsageTokens[];
  passed: boolean;
}

const report: {
  model?: string;
  cases: CaseReport[];
  analytics?: { processedTokens: number; turns: number; missingUsageTurns: number };
  passed: boolean;
  error?: string;
} = { cases: [], passed: false };

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

interface LogEntry {
  pid: number;
  start?: boolean;
  method?: string;
  sessionId?: string | null;
}

function protocol(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

await mkdir(join(install, "bin"), { recursive: true });
await writeFile(join(install, "antigravity-package.json"), `${JSON.stringify({ version: "1.4.3" })}\n`);
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

/** The usage records of one provider turn. */
function records(turnId: string): UsageTokens[] {
  return sqlite()
    .prepare("SELECT tokens_json FROM agent_usage_records WHERE turn_id = ? ORDER BY recorded_at, rowid")
    .all(turnId)
    .map((row) => decodeUsageTokens(JSON.parse(String(row.tokens_json))));
}

/** The provider turns that ran in one public thread, oldest first. */
function turnsOf(threadId: string): string[] {
  return sqlite()
    .prepare(
      `SELECT a.turn_id FROM agent_usage_activity a JOIN projection_provider_sessions s ON s.id = a.session_id
       WHERE a.kind = 'turn' AND s.thread_id = ? ORDER BY a.occurred_at, a.rowid`,
    )
    .all(threadId)
    .map((row) => String(row.turn_id));
}

const message = (turn: Turn) => `tokens=${turn.input},${turn.cached},${turn.output},${turn.thought}`;

/** Checks that the turn at `index` of the thread has one record with the tokens of `sent`. */
async function check(name: string, threadId: string, index: number, sent: Turn): Promise<void> {
  const turnId = await waitFor(`${name}: usage`, () => {
    const id = turnsOf(threadId)[index];
    return id && records(id).length > 0 && id;
  });
  const recorded = records(turnId);
  const result: CaseReport = { name, turnId, sent, recorded, passed: false };
  report.cases.push(result);
  assert.equal(recorded.length, 1, `${name}: one record for the turn`);
  assert.deepEqual(
    recorded[0],
    {
      uncachedInput: sent.input - sent.cached,
      cachedInput: sent.cached,
      cacheCreation: 0,
      output: sent.output + sent.thought,
    },
    `${name}: the turn's own tokens, with thinking as output`,
  );
  result.passed = true;
}

async function send(agentId: string, turn: Turn, label: string): Promise<void> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text: message(turn) }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${label}: no delivery`);
  const status = await waitFor(label, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  assert.equal(status, "completed", `${label}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
}

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const first: Turn = { input: 12_000, cached: 4_000, output: 800, thought: 300 };
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Gemini metering",
      description: "Checks Gemini usage metering.",
      avatarSeed: "gemini-metering",
      avatarHue: null,
      initialMessage: message(first),
    }),
  );
  report.model = agent.model;
  const threadId = await waitFor("the agent's own thread", () => store.list().find((a) => a.id === agent.id)?.threadId);
  await check("first turn", threadId, 0, first);
  await waitFor("the first turn to end", () => idle(agent.id));

  await send(agent.id, { input: 6_000, cached: 5_000, output: 200, thought: 0 }, "smaller second turn");
  await check("smaller second turn", threadId, 1, { input: 6_000, cached: 5_000, output: 200, thought: 0 });

  await send(agent.id, { input: 15_000, cached: 6_000, output: 900, thought: 400 }, "larger third turn");
  await check("larger third turn", threadId, 2, { input: 15_000, cached: 6_000, output: 900, thought: 400 });

  // The provider process stops between turns. The runtime starts it again and resumes the session,
  // and Antigravity measures the next turn from the restored total.
  const session = store.activeProviderSession(agent.id)?.externalSessionId;
  assert.ok(session, "the agent has a provider session");
  const killedPid = protocol().find((entry) => entry.start)?.pid ?? 0;
  assert.ok(killedPid, "the fake server logged its start");
  // Each session has a process of its own, so a start before the kill is not the restart.
  const startsBefore = protocol().filter((entry) => entry.start).length;
  process.kill(killedPid, "SIGTERM");
  await waitFor("Antigravity to start again", () => protocol().filter((entry) => entry.start).length > startsBefore);
  await waitFor("the provider to be ready again", () => agents.getStatus().phase === "ready");
  await send(agent.id, { input: 7_000, cached: 6_500, output: 100, thought: 50 }, "turn after a restart");
  await check("turn after a restart", threadId, 3, { input: 7_000, cached: 6_500, output: 100, thought: 50 });
  assert.equal(
    store.activeProviderSession(agent.id)?.externalSessionId,
    session,
    "the turn after a restart resumes the session",
  );

  const today = new Date().toISOString().slice(0, 10);
  const analytics = agents.getAnalytics({ agentId: agent.id, startDate: today, endDate: today, timeZone: "UTC" });
  report.analytics = {
    processedTokens: analytics.totals.processedTokens,
    turns: analytics.totals.turns,
    missingUsageTurns: analytics.totals.missingUsageTurns,
  };
  const sent = report.cases.reduce((sum, entry) => sum + entry.sent.input + entry.sent.output + entry.sent.thought, 0);
  assert.equal(analytics.totals.turns, 4, "Analytics count every turn.");
  assert.equal(analytics.totals.missingUsageTurns, 0, "Every turn has usage.");
  assert.equal(analytics.totals.processedTokens, sent, "Analytics count every turn's tokens once.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  closeReader();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
