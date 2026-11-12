// Checks that Gemini token usage through Antigravity is metered once per turn, with thinking as
// output. Runs the real agent service on a temporary profile with a fake Antigravity CLI 1.5.4 that
// prints its version and answers `session/prompt` as Antigravity does: `usage` holds the tokens of
// that prompt only, and `thoughtTokens` is apart from `outputTokens`. A message
// `tokens=<input>,<cached>,<output>,<thought>` sets the usage of its turn. Cases: a first turn, a
// smaller second turn in the same session (the session counter before this change booked 0 for it), a
// larger third turn (it booked only the excess over the largest turn), and a turn after the provider
// process starts again and resumes the session. The plan quota comes from a local `node:http` fake of
// Google's Code Assist service (`OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL`) with the CLI's token in a
// temporary `GEMINI_HOME`: a usage read after the turns gives the fake's window, sends no prompt to the
// CLI, and adds no turn or tokens to the metering.
// `bun scripts/antigravity-usage-metering-e2e.ts`. Writes
// .openbot-build/antigravity-usage-metering-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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
const install = join(root, "antigravity", "1.5.4");
const fakeAgy = join(install, "bin", "antigravity");
const logPath = join(root, "agy.jsonl");
// Bun reads the home folder once at its start, so the CLI's folder is set apart: never `~/.gemini`.
const geminiHome = join(home, ".gemini");
const ACCESS_TOKEN = "fake-metering-access-token";
const PROJECT = "fake-metering-project";

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
process.env.GEMINI_HOME = geminiHome;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.FAKE_AGY_LOG = logPath;
mkdirSync(home, { recursive: true });

/** The Code Assist calls, with the token that each one carried. */
const quotaCalls: { path: string | undefined; authorization: string | undefined }[] = [];
const quotaServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    quotaCalls.push({ path: request.url, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1internal:loadCodeAssist")
      return response.end(JSON.stringify({ cloudaicompanionProject: PROJECT }));
    response.end(
      JSON.stringify({
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              {
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                resetTime: "2026-11-17T11:59:31Z",
                remainingFraction: 0.75,
              },
            ],
          },
        ],
      }),
    );
  });
});
await new Promise<void>((done) => quotaServer.listen(0, "127.0.0.1", done));
const quotaAddress = quotaServer.address();
assert.ok(quotaAddress !== null && typeof quotaAddress === "object");
process.env.OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL = `http://127.0.0.1:${quotaAddress.port}/v1internal`;

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** An Antigravity CLI with the ACP methods that the service calls. It has no `/usage`. */
const FAKE_AGY = `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("1.5.4\\n");
  process.exit(0);
}
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
    log({ prompt: text });
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
  planUsage?: { usedPercent: number | undefined; quotaCalls: number; prompts: number };
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
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
  prompt?: string;
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
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
// The CLI's own token file, as after a Google sign-in.
await mkdir(join(geminiHome, "antigravity-acp"), { recursive: true });
await writeFile(
  join(geminiHome, "antigravity-acp", "antigravity-oauth-token"),
  JSON.stringify({
    token: {
      access_token: ACCESS_TOKEN,
      token_type: "Bearer",
      refresh_token: "fake-refresh",
      expiry: new Date(Date.now() + 3_600_000).toISOString(),
    },
    auth_method: "consumer",
    id_token_email: "",
  }),
  { mode: 0o600 },
);
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

  // The plan usage comes from Code Assist, not from a prompt: it adds no turn and no tokens.
  const promptsBefore = protocol().filter((entry) => entry.prompt !== undefined).length;
  const plan = await runCauseEffect(agents.getUsage(agent.id));
  const prompts = protocol().flatMap((entry) => (entry.prompt === undefined ? [] : [entry.prompt]));
  report.planUsage = {
    usedPercent: plan.limits[0]?.secondary?.usedPercent,
    quotaCalls: quotaCalls.length,
    prompts: prompts.length,
  };
  assert.equal(report.planUsage.usedPercent, 25, "the plan usage is the fake's Gemini window");
  assert.ok(
    quotaCalls.some((call) => call.path === "/v1internal:retrieveUserQuotaSummary"),
    "the usage read asked Code Assist",
  );
  assert.ok(
    quotaCalls.every((call) => call.authorization === `Bearer ${ACCESS_TOKEN}`),
    "every call carries the token",
  );
  assert.equal(prompts.length, promptsBefore, "the usage read sends no prompt");
  assert.ok(
    prompts.every((prompt) => !prompt.startsWith("/usage")),
    "no prompt is `/usage`",
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
  await new Promise<void>((done) => quotaServer.close(() => done()));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
