// Checks the Codex usage reset (#2859). Runs the real agent service on a temporary profile with a fake
// Codex app-server that counts usage reset credits in `account/rateLimits/read` and spends one on
// `account/rateLimitResetCredit/consume`, as Codex 0.160.1 does. The first turn hits the plan limit, so
// the usage limit gate holds the agent. Cases: the credits are read; a reset answers `reset`, spends one
// credit with one idempotency key, and the held message runs; a second reset with no spent limit answers
// `nothingToReset`, spends none, and ends a hold that a refused turn left; a credential change, as when a
// key is saved, ends a hold; a message from the user tries one turn before the reset, which a spent
// plan refuses again with no second notice, and which runs the held messages after the account changed
// outside OpenBot; another provider is refused.
// `bun scripts/codex-usage-reset-e2e.ts`. Writes .openbot-build/codex-usage-reset-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-usage-reset-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-usage-reset-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const consumeLog = join(root, "consumed.jsonl");
const refusedLog = join(root, "refused.jsonl");
const turnLog = join(root, "turns.jsonl");
/** Its presence makes the next turn find a new account with an unspent plan, as a sign-in in a terminal does. */
const switchedFlag = join(root, "switched");

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
 * A Codex app-server with the methods that the service calls. A turn whose text has "limit" spends the
 * plan, and while the plan is spent each turn fails as Codex fails it. A reset credit restores it.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, rmSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
let credits = 2;
let spent = false;
let hit = false;
const resetsAt = Math.floor(Date.now() / 1000) + 3600;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const rateLimits = () => ({
  rateLimits: { limitId: "codex", primary: { usedPercent: spent ? 100 : 10, windowDurationMins: 300, resetsAt }, secondary: null },
  rateLimitsByLimitId: null,
  rateLimitResetCredits: { availableCount: credits, credits: null },
});
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: rateLimits() });
    case "account/rateLimitResetCredit/consume": {
      const outcome = credits === 0 ? "noCredit" : spent ? "reset" : "nothingToReset";
      if (outcome === "reset") { credits -= 1; spent = false; }
      appendFileSync(${JSON.stringify(consumeLog)}, JSON.stringify({ idempotencyKey: params.idempotencyKey, outcome }) + "\\n");
      return write({ id: message.id, result: { outcome } });
    }
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
      // Unique across a restart, as Codex turn ids are: the service ignores the end of a turn id it saw end.
      const turnId = "turn-" + process.pid + "-" + (++turns);
      if (!hit && JSON.stringify(params.input).includes("limit")) { hit = true; spent = true; }
      if (JSON.stringify(params.input).includes("Exhaust")) spent = true;
      if (existsSync(${JSON.stringify(switchedFlag)})) { rmSync(${JSON.stringify(switchedFlag)}); spent = false; }
      appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify(params.input) + "\\n");
      // A refusal that the plan does not show, as when Codex counted a limit that ended since. Once per
      // message, also across a restart, so the retry of a released message runs.
      const input = JSON.stringify(params.input);
      const refused = existsSync(${JSON.stringify(refusedLog)}) ? readFileSync(${JSON.stringify(refusedLog)}, "utf8").split("\\n") : [];
      const transient = input.includes("transient") && !refused.includes(input);
      if (transient) appendFileSync(${JSON.stringify(refusedLog)}, input + "\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      setTimeout(() => {
        if (spent || transient) {
          const error = { message: "You've hit your usage limit. Try again later.", codexErrorInfo: "usageLimitExceeded" };
          write({ method: "error", params: { threadId: params.threadId, turnId, error, willRetry: false } });
          write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "failed", error } } });
          return;
        }
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

interface CaseReport {
  name: string;
  details: unknown;
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

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

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turnInputs(): string[] {
  try {
    return readFileSync(turnLog, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function consumed(): { idempotencyKey: unknown; outcome: string }[] {
  try {
    return readFileSync(consumeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
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

try {
  await runCauseEffect(agents.initialize());
  // The dock's reading starts Codex and counts its credits.
  await runCauseEffect(agents.getUsage());
  const before = await runCauseEffect(agents.providerUsageResets("codex"));
  assert.deepEqual(before, [{ provider: "codex", accountId: DEFAULT_PROVIDER_ACCOUNT_ID, available: 2 }]);
  report.cases.push({ name: "credits are read", details: before, passed: true });

  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Reset",
      description: "Checks the usage reset.",
      avatarSeed: "reset",
      avatarHue: null,
      initialMessage: "Spend the limit.",
    }),
  );
  const held = await waitFor("the usage limit to hold the agent", () =>
    agents.getRuntimeSnapshot().usageLimits?.find((limit) => limit.agentId === agent.id),
  );
  const waiting = agents.listQueue(agent.id).deliveries.map((delivery) => delivery.status);
  assert.ok(waiting.includes("queued"), `The refused message waits in the queue: ${waiting.join(", ")}`);
  report.cases.push({ name: "the plan limit holds the agent", details: { held, waiting }, passed: true });

  const outcome = await runCauseEffect(agents.resetProviderUsage("codex", DEFAULT_PROVIDER_ACCOUNT_ID));
  assert.equal(outcome, "reset");
  const resets = consumed();
  assert.equal(resets.length, 1, "One reset sends one consume.");
  assert.equal(typeof resets[0]?.idempotencyKey, "string", "The consume names an idempotency key.");
  assert.ok(
    !agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    "The reset ends the limit at once.",
  );
  await waitFor("the held message to run", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  const after = await runCauseEffect(agents.providerUsageResets("codex"));
  assert.deepEqual(after, [{ provider: "codex", accountId: DEFAULT_PROVIDER_ACCOUNT_ID, available: 1 }]);
  const usage = await runCauseEffect(agents.getUsage());
  const primary = usage.limits.find((limit) => limit.id === "codex")?.primary;
  assert.equal(primary?.usedPercent, 10, "The reading after the reset shows the restored limit.");
  report.cases.push({
    name: "a reset spends one credit and runs the held message",
    details: { outcome, resets, after, primary },
    passed: true,
  });

  // A refused turn holds the agent, but the plan shows no spent window: the gate waits for its timer.
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "A transient refusal." }));
  await waitFor("the refusal to hold the agent again", () =>
    agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
  );
  const nothing = await runCauseEffect(agents.resetProviderUsage("codex", DEFAULT_PROVIDER_ACCOUNT_ID));
  assert.equal(nothing, "nothingToReset");
  const second = consumed();
  assert.equal(second.length, 2);
  assert.notEqual(second[1]?.idempotencyKey, second[0]?.idempotencyKey, "Each reset has its own key.");
  assert.ok(
    !agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    "Nothing to reset ends the hold, because no limit of the account is spent.",
  );
  await waitFor("the message after the refusal to run", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  const left = await runCauseEffect(agents.providerUsageResets("codex"));
  assert.equal(left[0]?.available, 1, "A reset with nothing to reset spends no credit.");
  report.cases.push({
    name: "nothing to reset spends no credit and ends a hold that is out of date",
    details: { nothing, left },
    passed: true,
  });

  // A new key serves the provider's own sign-in, so the old credential's limit no longer applies.
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Another transient refusal." }));
  await waitFor("the refusal to hold the agent before the credential change", () =>
    agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
  );
  await runCauseEffect(agents.changeProviderCredential("codex", () => Effect.void));
  assert.ok(
    !agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    "A credential change ends the hold.",
  );
  await waitFor("the message after the credential change to run", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  assert.equal(consumed().length, 2, "A credential change spends no reset credit.");
  report.cases.push({ name: "a credential change ends a hold", details: null, passed: true });

  // The plan is spent and the reading names its reset an hour away, so the gate waits for it.
  const notices: number[] = [];
  const onEvent = (event: AgentEvent) => {
    if (event.type === "usage-limit-reached" && event.agentId === agent.id) notices.push(event.agentCount);
  };
  agents.on("event", onEvent);
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Exhaust the plan." }));
  const spentHold = await waitFor("the spent plan to hold the agent", () =>
    agents.getRuntimeSnapshot().usageLimits?.find((limit) => limit.agentId === agent.id && limit.resetsAt !== null),
  );
  await waitFor("the first notice", () => notices.length === 1);
  // A message from the user tries one turn. The plan is still spent, so the turn is refused, both
  // messages wait again, and the user is not told about the same limit twice.
  const turnsBefore = turnInputs().length;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Still spent?" }));
  await waitFor("the user's message to try a turn", () => turnInputs().length > turnsBefore);
  const stillHeld = await waitFor("the refused try to hold both messages again", () => {
    const statuses = agents
      .listQueue(agent.id)
      .deliveries.map((delivery) => delivery.status)
      .filter((status) => status !== "completed");
    return (
      statuses.length === 2 &&
      statuses.every((status) => status === "queued") &&
      agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id) &&
      statuses
    );
  });
  assert.equal(notices.length, 1, "A refused try does not announce the limit again.");
  assert.equal(turnInputs().length, turnsBefore + 1, "One message from the user tries one turn.");
  // The user signs Codex in to another account outside OpenBot. Nothing tells the gate, so only a
  // new message tries again, long before the old account's reset.
  writeFileSync(switchedFlag, "");
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "After the account switch." }));
  await waitFor("the held messages to run on the new account", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  assert.ok(
    !agents.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    "A completed try ends the limit.",
  );
  assert.equal(consumed().length, 2, "A try spends no reset credit.");
  agents.off("event", onEvent);
  report.cases.push({
    name: "a message from the user tries one turn before the reset",
    details: { spentHold, stillHeld, notices },
    passed: true,
  });

  const refused = await runCauseEffect(agents.resetProviderUsage("claude", DEFAULT_PROVIDER_ACCOUNT_ID)).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(refused?.includes("cannot reset usage limits"), `Another provider is refused: ${refused}`);
  assert.equal(consumed().length, 2, "A refused reset sends nothing to Codex.");
  report.cases.push({ name: "another provider is refused", details: { refused }, passed: true });
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
