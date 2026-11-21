import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, decodeUsageTokens, type UsageTokens } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { installFakeAgent } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-usage-metering-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-cursor-metering-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCursor = join(root, "cursor", "cursor-agent");

process.env.HOME = home;
process.env.OPENBOT_CURSOR_PATH = fakeCursor;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

await installFakeAgent(fakeCursor, "cursor-usage-metering");

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

interface CaseReport {
  name: string;
  turnId: string;
  sent: UsageTokens;
  recorded: UsageTokens[];
  passed: boolean;
}

const report: {
  cases: CaseReport[];
  analytics?: { processedTokens: number; turns: number; missingUsageTurns: number };
  passed: boolean;
  error?: string;
} = { cases: [], passed: false };

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 60_000): Promise<T> {
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
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "cursor",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "cursor"),
});
function records(turnId: string): UsageTokens[] {
  return database.connection
    .prepare("SELECT tokens_json FROM agent_usage_records WHERE turn_id = ? ORDER BY recorded_at, rowid")
    .all(turnId)
    .map((row) => decodeUsageTokens(JSON.parse(String(row.tokens_json))));
}

function turnsOf(threadId: string): string[] {
  return database.connection
    .prepare(
      `SELECT a.turn_id FROM agent_usage_activity a JOIN projection_provider_sessions s ON s.id = a.session_id
       WHERE a.kind = 'turn' AND s.thread_id = ? ORDER BY a.occurred_at, a.rowid`,
    )
    .all(threadId)
    .map((row) => String(row.turn_id));
}

async function check(name: string, threadId: string, index: number, sent: UsageTokens): Promise<void> {
  const turnId = await waitFor(`${name}: usage`, () => {
    const id = turnsOf(threadId)[index];
    return id && records(id).length > 0 && id;
  });
  const recorded = records(turnId);
  const result: CaseReport = { name, turnId, sent, recorded, passed: false };
  report.cases.push(result);
  assert.equal(recorded.length, 1, `${name}: one record for the turn`);
  assert.deepEqual(recorded[0], sent, `${name}: recorded tokens match`);
  result.passed = true;
}

async function send(agentId: string, text: string, label: string): Promise<void> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
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
  const meta: UsageTokens = { uncachedInput: 100, cachedInput: 0, cacheCreation: 0, output: 50 };
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Cursor metering",
      description: "Checks Cursor usage metering.",
      avatarSeed: "cursor-metering",
      avatarHue: null,
      initialMessage: `meta tokens=100,0,0,50`,
    }),
  );
  const threadId = await waitFor("the agent's own thread", () => store.list().find((a) => a.id === agent.id)?.threadId);
  await check("meta usage", threadId, 0, meta);
  await waitFor("the first turn to end", () => idle(agent.id));

  const update: UsageTokens = { uncachedInput: 185, cachedInput: 10, cacheCreation: 5, output: 80 };
  await send(agent.id, "update tokens=200,10,5,80", "usage_update metering");
  await check("usage_update metering", threadId, 1, update);
  await waitFor("the second turn to end", () => idle(agent.id));

  await send(agent.id, "ping", "unmetered turn");
  await waitFor("the third turn to end", () => idle(agent.id));
  const unmeteredTurnId = turnsOf(threadId)[2];
  assert.ok(unmeteredTurnId, "third turn exists");
  assert.equal(records(unmeteredTurnId).length, 0, "a turn with no metering leaves no usage record");

  const today = new Date().toISOString().slice(0, 10);
  const analytics = agents.getAnalytics({ agentId: agent.id, startDate: today, endDate: today, timeZone: "UTC" });
  report.analytics = {
    processedTokens: analytics.totals.processedTokens,
    turns: analytics.totals.turns,
    missingUsageTurns: analytics.totals.missingUsageTurns,
  };
  assert.equal(analytics.totals.turns, 3, "Analytics count every turn.");
  assert.equal(analytics.totals.missingUsageTurns, 0, "Cursor turns without metering are not missing.");
  assert.equal(analytics.totals.processedTokens, 100 + 50 + 200 + 10 + 5 + 80, "Analytics sum metered tokens.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
