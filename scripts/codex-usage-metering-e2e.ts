// Checks that Codex usage is metered in the agent's own chat and in its tasks, once, with the list
// price (#2686). Runs the real agent service on a temporary profile with a fake Codex app-server
// that reports `thread/tokenUsage/updated` as Codex 0.160.1 does: cumulative `total` and per-request
// `last` counts, with cache writes in `cacheWriteInputTokens`. A message `prompts=<a>,<b>` makes one
// model request per number, each with that many input tokens. Cases: a chat turn, a task turn, a task
// request of 250,000 input tokens (short-context price), one of 300,000 (long-context price), and a
// chat session that the counter before this change counted (its first update records only its own
// request).
// `bun scripts/codex-usage-metering-e2e.ts`. Writes .openbot-build/codex-usage-metering-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, decodeUsageTokens, type UsageTokens } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-usage-metering-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-usage-metering-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/**
 * A Codex app-server with the methods that the service calls. Each request reuses the prompt of the
 * request before it as cached input, and writes half of its new input to the cache.
 */
const FAKE_CODEX = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** threadId -> cumulative counts and the prompt of the last request. */
const usage = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const breakdown = (input, cached, written, output) => ({ totalTokens: input + output, inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: written, outputTokens: output, reasoningOutputTokens: 0 });
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
      const prompts = (/prompts=([0-9,]+)/.exec(JSON.stringify(params.input))?.[1] ?? "1000").split(",").map(Number);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const total = usage.get(params.threadId) ?? { input: 0, cached: 0, written: 0, output: 0, prompt: 0 };
      for (const prompt of prompts) {
        const cached = Math.min(total.prompt, prompt);
        const written = Math.floor((prompt - cached) / 2);
        Object.assign(total, { input: total.input + prompt, cached: total.cached + cached, written: total.written + written, output: total.output + 100, prompt });
        const tokenUsage = { total: breakdown(total.input, total.cached, total.written, total.output), last: breakdown(prompt, cached, written, 100), modelContextWindow: 1000000 };
        write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage } });
      }
      usage.set(params.threadId, total);
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 50);
      return;
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
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

// The GPT-6 Luna list prices, per million tokens, from https://developers.openai.com/api/docs/pricing
// on 2026-10-21. "Long context: >272K input tokens".
const SHORT = { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 };
const LONG = { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 0.75 };

/** The records and the cost that the fake's requests of one turn must give. */
function expected(prompts: number[], previousPrompt: number) {
  let prompt = previousPrompt;
  return prompts.map((next) => {
    const cachedInput = Math.min(prompt, next);
    const cacheCreation = Math.floor((next - cachedInput) / 2);
    const tokens = { uncachedInput: next - cachedInput - cacheCreation, cachedInput, cacheCreation, output: 100 };
    const rates = next > 272_000 ? LONG : SHORT;
    prompt = next;
    return {
      tokens,
      context: next > 272_000 ? "long" : "short",
      cost:
        (tokens.uncachedInput * rates.input +
          tokens.cachedInput * rates.cached +
          tokens.cacheCreation * rates.cacheWrite +
          tokens.output * rates.output) /
        1_000_000,
    };
  });
}

interface UsageRecord {
  agentId: string;
  threadId: string;
  turnId: string;
  model: string;
  tokens: UsageTokens;
  cost: number | null;
  context: string | null;
}

interface CaseReport {
  name: string;
  threadId: string;
  turnId: string;
  records: UsageRecord[];
  expectedCost: number;
  passed: boolean;
}

const report: {
  model?: string;
  cases: CaseReport[];
  analytics?: { estimatedCostUsd: number | null; processedTokens: number; turns: number; unpricedRecords: number };
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
// A second connection reads the usage tables and sets up the counter of an earlier release.
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

/** The usage records of one provider turn, with the public thread of their session. */
function records(turnId: string): UsageRecord[] {
  return sqlite()
    .prepare(
      `SELECT r.agent_id, s.thread_id, r.turn_id, r.model, r.tokens_json, r.estimated_cost_usd, r.rate_basis
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
      cost: typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : null,
      context: typeof row.rate_basis === "string" ? (JSON.parse(row.rate_basis).context ?? null) : null,
    }));
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

async function settled(deliveryId: string, label: string) {
  const status = await waitFor(label, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  assert.equal(status, "completed", `${label}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
}

function check(name: string, threadId: string, turnId: string, agentId: string, want: ReturnType<typeof expected>) {
  const got = records(turnId);
  const result: CaseReport = {
    name,
    threadId,
    turnId,
    records: got,
    expectedCost: want.reduce((sum, entry) => sum + entry.cost, 0),
    passed: false,
  };
  report.cases.push(result);
  assert.equal(got.length, want.length, `${name}: one record per reported request`);
  for (const [index, entry] of want.entries()) {
    const record = got[index];
    assert.ok(record);
    assert.equal(record.agentId, agentId, `${name}: the record belongs to the agent`);
    assert.equal(record.threadId, threadId, `${name}: the record belongs to the thread of the turn`);
    assert.deepEqual(record.tokens, entry.tokens, `${name}: request ${index + 1} tokens`);
    assert.equal(record.context, entry.context, `${name}: request ${index + 1} context price`);
    assert.ok(record.cost !== null && Math.abs(record.cost - entry.cost) < 1e-12, `${name}: request ${index + 1} cost`);
  }
  result.passed = true;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Metering",
      description: "Checks usage metering.",
      avatarSeed: "metering",
      avatarHue: null,
      initialMessage: "prompts=12000,15000",
    }),
  );
  report.model = agent.model;
  assert.equal(agent.model, "gpt-6-luna", "The check prices GPT-6 Luna.");
  const chatThread = await waitFor(
    "the agent's own thread",
    () => store.list().find((a) => a.id === agent.id)?.threadId,
  );
  const chatTurn = await waitFor(
    "the chat turn to report usage",
    () => records(turnsOf(chatThread)[0] ?? "").length === 2 && turnsOf(chatThread)[0],
  );
  await waitFor("the chat turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  check("chat turn", chatThread, chatTurn, agent.id, expected([12000, 15000], 0));

  const task = await runCauseEffect(agents.startTask({ agentId: agent.id, text: "prompts=12000,15000" }));
  assert.notEqual(task.threadId, chatThread, "The task runs in its own thread.");
  const taskTurn = await waitFor(
    "the task turn to report usage",
    () => records(turnsOf(task.threadId)[0] ?? "").length === 2 && turnsOf(task.threadId)[0],
  );
  await waitFor("the task turn to end", () => agents.listTasks(agent.id).tasks.find((t) => t.id === task.id)?.outcome);
  check("task turn", task.threadId, taskTurn, agent.id, expected([12000, 15000], 0));

  // Under the old rule, any update with 200,000 or more input tokens stayed unpriced.
  for (const [index, prompt] of [250_000, 300_000].entries()) {
    const receipt = await runCauseEffect(
      agents.sendMessage({ agentId: agent.id, taskId: task.id, text: `prompts=${prompt}` }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId);
    await settled(deliveryId, `task request of ${prompt} tokens`);
    const turnId = turnsOf(task.threadId)[index + 1];
    assert.ok(turnId, `task request of ${prompt} tokens: no turn`);
    check(
      `task request of ${prompt} tokens`,
      task.threadId,
      turnId,
      agent.id,
      expected([prompt], index === 0 ? 15000 : 250_000),
    );
  }

  // A session from before collection started, that the release before this change counted: its
  // counter has no cache writes.
  const sessionId = String(
    sqlite().prepare("SELECT id FROM projection_provider_sessions WHERE thread_id = ?").get(chatThread)?.id,
  );
  sqlite()
    .prepare("UPDATE projection_provider_sessions SET created_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", sessionId);
  sqlite()
    .prepare("DELETE FROM agent_usage_checkpoints WHERE agent_id = ? AND counter_id = ?")
    .run(agent.id, `${sessionId}:codex:cache-writes`);
  sqlite()
    .prepare("INSERT INTO agent_usage_checkpoints VALUES (?, ?, ?)")
    .run(
      agent.id,
      `${sessionId}:codex`,
      JSON.stringify({ uncachedInput: 15000, cachedInput: 12000, cacheCreation: 0, output: 200, reportedCost: null }),
    );
  const upgrade = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "prompts=20000,21000" }));
  const upgradeDelivery = upgrade.deliveries[0]?.id;
  assert.ok(upgradeDelivery);
  await settled(upgradeDelivery, "chat turn after the upgrade");
  const upgradeTurn = turnsOf(chatThread)[1];
  assert.ok(upgradeTurn, "chat turn after the upgrade: no turn");
  // The new counter starts from the totals before the first request, so both requests count once.
  check("chat turn after the upgrade", chatThread, upgradeTurn, agent.id, expected([20000, 21000], 15000));

  const today = new Date().toISOString().slice(0, 10);
  const analytics = agents.getAnalytics({ agentId: agent.id, startDate: today, endDate: today, timeZone: "UTC" });
  const recorded = report.cases.flatMap((entry) => entry.records);
  report.analytics = {
    estimatedCostUsd: analytics.totals.estimatedCostUsd,
    processedTokens: analytics.totals.processedTokens,
    turns: analytics.totals.turns,
    unpricedRecords: analytics.totals.unpricedRecords,
  };
  const cost = recorded.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  const tokens = recorded.reduce(
    (sum, record) =>
      sum +
      (record.tokens.uncachedInput ?? 0) +
      (record.tokens.cachedInput ?? 0) +
      (record.tokens.cacheCreation ?? 0) +
      (record.tokens.output ?? 0),
    0,
  );
  assert.equal(analytics.totals.turns, 5, "Analytics count the chat and task turns.");
  assert.equal(analytics.totals.missingUsageTurns, 0, "Every turn has usage.");
  assert.equal(analytics.totals.unpricedRecords, 0, "Every record is priced.");
  assert.equal(analytics.totals.processedTokens, tokens, "Analytics count each record once.");
  assert.ok(
    analytics.totals.estimatedCostUsd !== null && Math.abs(analytics.totals.estimatedCostUsd - cost) < 1e-12,
    "Analytics count each cost once.",
  );
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
