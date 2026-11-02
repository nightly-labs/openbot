// Checks that a Claude turn after a resume books only its own requests. Runs the real agent service
// on a temporary profile. Claude is the real `ClaudeAgentClient`, which the Claude Agent SDK connects
// to a stand-in `claude` executable. Like the real CLI, the stand-in saves the session's cumulative
// `modelUsage` and restores it on `--resume`, and it repeats each request's message once per content
// block. A message `usage-prompts=<a>,<b>` makes one request per number, with that many cached input
// tokens. Turns: two in a new process, an idle release of the process, then two in the resumed one.
// Before this change, the first turn after the resume booked the whole session again. The SDK cost of
// that turn is not known, so it gets the list-price estimate of its own tokens.
// `bun run test:claude-usage-resume`. Writes .openbot-build/claude-usage-resume-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, decodeUsageTokens, defaultProviderModel, type UsageTokens } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-usage-resume-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-usage-resume-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const sessionsDir = join(root, "claude-sessions");
const spawnLog = join(root, "claude-spawns.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
/** Claude keys `modelUsage` with the `[1m]` suffix of a 1M context, but its messages name the model without it. */
const USAGE_MODEL = `${CLAUDE_MODEL}[1m]`;
/** The stand-in's counts for each request, and its list-price cost. */
const UNCACHED = 10;
const CACHE_WRITE = 5;
const OUTPUT = 20;
const REQUEST_COST = 0.01;

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { estimateUsageCost } = await import("../src/backend/agent/usage-pricing");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end.
// An even request reports its cache write; an odd one leaves the count out, as the API does for 0.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const resume = option("--resume");
const sessionId = resume ?? option("--session-id") ?? randomUUID();
fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({ pid: process.pid, resume, sessionId }) + "\\n");
const file = join(${JSON.stringify(sessionsDir)}, sessionId + ".json");
const empty = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
// The real CLI saves a \`cost-state\` entry and restores it with the session.
const total = resume && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { ...empty };
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let requests = 0;
const turn = (message) => {
  const prompts = (/usage-prompts=([0-9,]+)/.exec(JSON.stringify(message))?.[1] ?? "100").split(",").map(Number);
  prompts.forEach((prompt, index) => {
    const id = "msg_" + process.pid + "_" + (++requests);
    const usage = { input_tokens: ${UNCACHED}, cache_read_input_tokens: prompt, output_tokens: ${OUTPUT} };
    if (requests % 2 === 0) usage.cache_creation_input_tokens = ${CACHE_WRITE};
    const last = index === prompts.length - 1;
    const content = last ? [{ type: "text", text: "Done." }] : [{ type: "tool_use", id: "tool_" + id, name: "Read", input: {} }];
    // The first copy of the message has the count from the start of the stream.
    for (const copy of [{ ...usage, output_tokens: 1 }, usage])
      write({ type: "assistant", message: { id, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
        content, stop_reason: null, usage: copy }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    total.inputTokens += usage.input_tokens;
    total.cacheReadInputTokens += usage.cache_read_input_tokens;
    total.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
    total.outputTokens += usage.output_tokens;
    total.costUSD += ${REQUEST_COST};
  });
  fs.writeFileSync(file, JSON.stringify(total));
  write({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: prompts.length, total_cost_usd: total.costUSD,
    usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [],
    modelUsage: { ${JSON.stringify(USAGE_MODEL)}: { ...total, webSearchRequests: 0, contextWindow: 200000, maxOutputTokens: 32000 } } });
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request")
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. Sessions, turns and events go to the real client.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  canReleaseProcess = () => this.#real.canReleaseProcess();

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: CLAUDE_MODEL, displayName: "Claude" }] }));
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    this.#real.respondError(id, error);
  }
}

interface TurnReport {
  name: string;
  turnId: string;
  process: number;
  resumed: boolean;
  recorded: UsageTokens;
  expected: UsageTokens;
  cost: number | null;
  expectedCost: number | null;
  passed: boolean;
}

const report: {
  model: string;
  turns: TurnReport[];
  /** What the release before this change booked for the first turn after the resume. */
  oldFirstResumedTurn?: UsageTokens;
  passed: boolean;
  error?: string;
} = { model: USAGE_MODEL, turns: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
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

/** Each start of the stand-in for a session. */
function spawns(): { pid: number; resume: string | null; sessionId: string }[] {
  try {
    return readFileSync(spawnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** The tokens that the stand-in's requests for these prompts report. */
function expected(prompts: number[], firstRequest: number): UsageTokens {
  return {
    uncachedInput: UNCACHED * prompts.length,
    cachedInput: prompts.reduce((sum, prompt) => sum + prompt, 0),
    cacheCreation: prompts.filter((_, index) => (firstRequest + index) % 2 === 0).length * CACHE_WRITE,
    output: OUTPUT * prompts.length,
  };
}

function sum(entries: UsageTokens[]): UsageTokens {
  const total: UsageTokens = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
  for (const entry of entries)
    for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const)
      total[key] = (total[key] ?? 0) + (entry[key] ?? 0);
  return total;
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const claudeClients: ClaudeStandIn[] = [];
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  clientFactory: (_provider, cli) => {
    const client = new ClaudeStandIn(cli);
    claudeClients.push(client);
    return client;
  },
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

/** The provider turns of one agent, oldest first. */
function turnsOf(agentId: string): string[] {
  return sqlite()
    .prepare(
      "SELECT turn_id FROM agent_usage_activity WHERE kind = 'turn' AND agent_id = ? ORDER BY occurred_at, rowid",
    )
    .all(agentId)
    .map((row) => String(row.turn_id));
}

function records(turnId: string): { tokens: UsageTokens; cost: number | null }[] {
  return sqlite()
    .prepare("SELECT tokens_json, estimated_cost_usd FROM agent_usage_records WHERE turn_id = ? AND model = ?")
    .all(turnId, USAGE_MODEL)
    .map((row) => ({
      tokens: decodeUsageTokens(JSON.parse(String(row.tokens_json))),
      cost: typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : null,
    }));
}

function idle(agentId: string): boolean {
  return !agents
    .listQueue(agentId)
    .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
}

/** The stand-in process of the last turn, and the requests it has made. */
let processes = 0;
let requestsSoFar = 0;
/** Sends the message of a turn, or with `send` false, waits for the agent's first turn. */
async function runTurn(agentId: string, name: string, prompts: number[], send: boolean) {
  const index = send ? turnsOf(agentId).length : 0;
  if (send) {
    const receipt = await runCauseEffect(agents.sendMessage({ agentId, text: `usage-prompts=${prompts.join(",")}` }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `${name}: no delivery`);
    const status = await waitFor(`${name} to end`, () => {
      const value = mailbox.getDelivery(deliveryId)?.delivery.status;
      return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
    });
    assert.equal(status, "completed", `${name}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
  }
  const turnId = await waitFor(`${name} to report usage`, () => {
    const id = turnsOf(agentId)[index];
    return id && records(id).length > 0 && id;
  });
  await waitFor(`${name} to leave the queue`, () => idle(agentId));
  const spawn = spawns().at(-1);
  assert.ok(spawn, `${name}: the stand-in never started`);
  // Each process numbers its requests from 1.
  if (spawns().length !== processes) {
    processes = spawns().length;
    requestsSoFar = 0;
  }
  const want = expected(prompts, requestsSoFar + 1);
  const firstResumed = spawn.resume !== null && requestsSoFar === 0;
  requestsSoFar += prompts.length;
  const got = records(turnId);
  const entry: TurnReport = {
    name,
    turnId,
    process: processes,
    resumed: spawn.resume !== null,
    recorded: sum(got.map((record) => record.tokens)),
    expected: want,
    cost: got[0]?.cost ?? null,
    expectedCost: firstResumed
      ? estimateUsageCost("claude", USAGE_MODEL, want, null).cost
      : REQUEST_COST * prompts.length,
    passed: false,
  };
  report.turns.push(entry);
  assert.equal(got.length, 1, `${name}: one record for the model`);
  assert.deepEqual(entry.recorded, want, `${name}: the turn books only its own requests`);
  assert.ok(entry.expectedCost !== null, `${name}: ${CLAUDE_MODEL} has a list price`);
  assert.ok(entry.cost !== null && Math.abs(entry.cost - entry.expectedCost) < 1e-9, `${name}: the turn's own cost`);
  entry.passed = true;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Resume usage",
      description: "Checks Claude usage after a resume.",
      avatarSeed: "resume-usage",
      avatarHue: null,
      initialMessage: "usage-prompts=1000,2000",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await runTurn(agent.id, "first turn in a new session", [1000, 2000], false);
  await runTurn(agent.id, "second turn in the same process", [3000], true);

  const before = spawns().length;
  const standIn = claudeClients.at(-1);
  assert.ok(standIn, "The service made no Claude client.");
  await runCauseEffect(standIn.releaseIdleThreads());
  await runTurn(agent.id, "first turn after the resume", [4000, 5000], true);
  const resumed = spawns().slice(before);
  assert.equal(resumed.length, 1, "The idle release ends the process, and the next turn starts one.");
  assert.ok(resumed[0]?.resume, "The next process resumes the saved session.");
  const saved = JSON.parse(readFileSync(join(sessionsDir, `${resumed[0]?.resume}.json`), "utf8"));
  report.oldFirstResumedTurn = {
    uncachedInput: saved.inputTokens,
    cachedInput: saved.cacheReadInputTokens,
    cacheCreation: saved.cacheCreationInputTokens,
    output: saved.outputTokens,
  };
  await runTurn(agent.id, "second turn after the resume", [6000], true);

  const today = new Date().toISOString().slice(0, 10);
  const analytics = agents.getAnalytics({ agentId: agent.id, startDate: today, endDate: today, timeZone: "UTC" });
  const all = sum(report.turns.map((turn) => turn.expected));
  assert.equal(analytics.totals.turns, 4, "Analytics count four turns.");
  assert.equal(
    analytics.totals.processedTokens,
    (all.uncachedInput ?? 0) + (all.cachedInput ?? 0) + (all.cacheCreation ?? 0) + (all.output ?? 0),
    "Analytics count each request once.",
  );
  report.passed = report.turns.every((turn) => turn.passed);
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
  for (const turn of report.turns) process.stdout.write(`${turn.passed ? "PASS" : "FAIL"} ${turn.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
