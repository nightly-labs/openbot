// Checks that usage through a custom ACP agent is metered with the cost it reports and with full
// token counts (#4181). Runs the real agent service on a temporary profile with a fake custom agent
// that reports session-total usage as the ACP contract documents it: the `usage_update` before the
// result carries the session's total cost in USD, and the `PromptResponse.usage` counts are the
// session's totals, with the uncached input reported on its own and `cachedReadTokens` and
// `cachedWriteTokens` left out when they are 0. A message
// `tokens=<input>,<cached>,<written>,<output>` adds those counts to the session, and `cost=<total>`
// sets the session cost the fake reports after its turn. Cases: a first turn with no cache fields,
// a turn whose cache reads stand above its uncached-only input, a turn with a cache write and a
// higher session cost, the first and next cost of a session whose cost checkpoint is missing, as
// one that ran before costs were kept has, and a turn over the old-shape token checkpoint of a
// session that a previous release saved, whose cache counts it left unknown.
// `bun scripts/custom-agent-usage-metering-e2e.ts`. Writes
// .openbot-build/custom-agent-usage-metering-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, decodeUsageTokens, type UsageTokens } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-agent-usage-metering-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-custom-metering-"));
const userData = join(root, "user-data");
const home = join(root, "home");

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Turn {
  input: number;
  cached: number;
  written: number;
  output: number;
  /** The session's total cost that the agent reports after this turn. */
  sessionCost?: number;
}

interface CaseReport {
  name: string;
  turnId: string;
  sent: Turn;
  recorded: UsageTokens[];
  expectedCost: number | null;
  recordedCost: number | null;
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

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const customAgents = new CustomAgentStore({ path: join(userData, "custom-agents.json"), cipher: xorCipher });
await runCauseEffect(customAgents.load());
await runCauseEffect(
  customAgents.save({
    id: "omp",
    name: "Oh My Pi",
    // The saved command runs the fake with the Bun that runs this test, so the check spawns no
    // shell wrapper.
    command: process.execPath,
    args: [resolve(import.meta.dirname, "provider-fakes/agents/custom-usage.ts")],
    env: [{ name: "FAKE_LOG", value: join(root, "omp.jsonl") }],
    usagePrompt: null,
  }),
);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  credentials: {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => customAgents.configs(),
  },
  preferredProvider: "acp",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "acp"),
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

/** The cost booked for one provider turn. */
function costOf(turnId: string): number | null {
  const value = sqlite()
    .prepare("SELECT estimated_cost_usd FROM agent_usage_records WHERE turn_id = ?")
    .get(turnId)?.estimated_cost_usd;
  return typeof value === "number" ? value : null;
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

const message = (turn: Turn) =>
  `tokens=${turn.input},${turn.cached},${turn.written},${turn.output}` +
  (turn.sessionCost === undefined ? "" : ` cost=${turn.sessionCost}`);

/** Checks that the turn at `index` of the thread has one record with the tokens of `sent` and `expectedCost`. */
async function check(
  name: string,
  threadId: string,
  index: number,
  sent: Turn,
  expectedCost: number | null,
): Promise<void> {
  const turnId = await waitFor(`${name}: usage`, () => {
    const id = turnsOf(threadId)[index];
    return id && records(id).length > 0 && id;
  });
  const recorded = records(turnId);
  const recordedCost = costOf(turnId);
  const result: CaseReport = { name, turnId, sent, recorded, expectedCost, recordedCost, passed: false };
  report.cases.push(result);
  assert.equal(recorded.length, 1, `${name}: one record for the turn`);
  assert.deepEqual(
    recorded[0],
    {
      uncachedInput: sent.input,
      cachedInput: sent.cached,
      cacheCreation: sent.written,
      output: sent.output,
    },
    `${name}: the turn's own tokens`,
  );
  if (expectedCost === null) assert.equal(recordedCost, null, `${name}: no cost`);
  else
    assert.ok(
      recordedCost !== null && Math.abs(recordedCost - expectedCost) < 1e-9,
      `${name}: cost ${recordedCost}, expected ${expectedCost}`,
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
  const first: Turn = { input: 12_000, cached: 0, written: 0, output: 800, sessionCost: 0.05 };
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Custom metering",
      description: "Checks custom agent usage metering.",
      avatarSeed: "custom-metering",
      avatarHue: null,
      initialMessage: message(first),
      provider: "acp",
      model: "omp/main",
    }),
  );
  report.model = agent.model;
  const threadId = await waitFor("the agent's own thread", () => store.list().find((a) => a.id === agent.id)?.threadId);
  await check("first turn", threadId, 0, first, 0.05);
  await waitFor("the first turn to end", () => idle(agent.id));

  // The agent reports its uncached input on its own, so its cache reads stand above `inputTokens`.
  // The count must still book, with the cache fields it reports next to it.
  const second: Turn = { input: 1_000, cached: 20_000, written: 0, output: 200 };
  await send(agent.id, second, "cache above the uncached input");
  await check("cache above the uncached input", threadId, 1, second, null);

  const third: Turn = { input: 1_000, cached: 6_000, written: 2_000, output: 900, sessionCost: 0.2 };
  await send(agent.id, third, "turn with a cache write");
  await check("turn with a cache write", threadId, 2, third, 0.15);

  // A session that has records but no cost checkpoint ran before its costs were kept. Its first
  // session total also counts that earlier use, so that turn has no cost and the next one books
  // the difference.
  const sessionId = store.activeProviderSession(agent.id)?.id;
  assert.ok(sessionId, "the agent has an active provider session");
  sqlite()
    .prepare("DELETE FROM agent_usage_checkpoints WHERE agent_id = ? AND counter_id = ?")
    .run(agent.id, `${sessionId}:grok:cost`);
  const fourth: Turn = { input: 1_000, cached: 1_000, written: 0, output: 200, sessionCost: 0.3 };
  await send(agent.id, fourth, "first cost of an older session");
  await check("first cost of an older session", threadId, 3, fourth, null);
  const fifth: Turn = { input: 500, cached: 500, written: 0, output: 100, sessionCost: 0.31 };
  await send(agent.id, fifth, "next cost of an older session");
  await check("next cost of an older session", threadId, 4, fifth, 0.01);

  // A session that an upgrade interrupted keeps the token checkpoint of the previous release: it
  // stored the unknown cache counts of a report without them as nulls next to the kept totals (and
  // a `reportedCost`, which the new cost counters replace). The fake has counted 15,500 uncached
  // input and 2,200 output over the five turns above, so the old checkpoint holds exactly those.
  // The next turn must book its own input and output, leave the cache counts unknown once, and
  // heal the checkpoint with its report, so the turns after it book whole again.
  sqlite()
    .prepare(
      "INSERT INTO agent_usage_checkpoints VALUES (?, ?, ?) ON CONFLICT(agent_id, counter_id) DO UPDATE SET tokens_json = excluded.tokens_json",
    )
    .run(
      agent.id,
      `${sessionId}:grok`,
      JSON.stringify({
        uncachedInput: 15_500,
        cachedInput: null,
        cacheCreation: null,
        output: 2_200,
        reportedCost: null,
      }),
    );
  const sixth: Turn = { input: 700, cached: 0, written: 0, output: 300 };
  await send(agent.id, sixth, "turn after an upgrade checkpoint");
  const upgradeTurnId = await waitFor("turn after an upgrade checkpoint: usage", () => {
    const id = turnsOf(threadId)[5];
    return id && records(id).length > 0 && id;
  });
  const upgradeRecord = records(upgradeTurnId);
  // The shared `check` needs four numbers; this turn books its cache counts as unknown on purpose.
  const upgrade: CaseReport = {
    name: "turn after an upgrade checkpoint",
    turnId: upgradeTurnId,
    sent: sixth,
    recorded: upgradeRecord,
    expectedCost: null,
    recordedCost: costOf(upgradeTurnId),
    passed: false,
  };
  report.cases.push(upgrade);
  assert.equal(upgradeRecord.length, 1, "turn after an upgrade checkpoint: one record for the turn");
  assert.deepEqual(
    upgradeRecord[0],
    { uncachedInput: sixth.input, cachedInput: null, cacheCreation: null, output: sixth.output },
    "turn after an upgrade checkpoint: the turn's own tokens, with the cache unknown once",
  );
  assert.equal(upgrade.recordedCost, null, "turn after an upgrade checkpoint: no cost");
  upgrade.passed = true;

  const today = new Date().toISOString().slice(0, 10);
  const analytics = agents.getAnalytics({ agentId: agent.id, startDate: today, endDate: today, timeZone: "UTC" });
  report.analytics = {
    processedTokens: analytics.totals.processedTokens,
    turns: analytics.totals.turns,
    missingUsageTurns: analytics.totals.missingUsageTurns,
  };
  const sent = report.cases.reduce(
    (sum, { sent: turn }) => sum + turn.input + turn.cached + turn.written + turn.output,
    0,
  );
  assert.equal(analytics.totals.turns, 6, "Analytics count every turn.");
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
