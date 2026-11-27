import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-pool-workspace-credits-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-pool-credits-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const accountsRoot = join(root, "provider-accounts");
const fakeCodex = join(root, "codex");
const turnLog = join(root, "codex-turns.jsonl");
const emptyAccountFile = join(root, "empty-account");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const MARK = "CREDITS-OUT";
const CREDITS_TEXT = "Your workspace is out of credits. Add credits to continue.";
const CATALOG = [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }];

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.172.0\\n");
  process.exit(0);
}
const account = process.env.CODEX_HOME.startsWith(${JSON.stringify(accountsRoot)}) ? "second" : "default";
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const emptyAccount = () => {
  try {
    return readFileSync(${JSON.stringify(emptyAccountFile)}, "utf8").trim();
  } catch {
    return "";
  }
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: account + "@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: ${JSON.stringify(CATALOG)} } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + account + "-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + account + "-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      const marked = text.includes(${JSON.stringify(MARK)});
      const empty = marked && emptyAccount() === account;
      appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ account, turnId, marked, empty }) + "\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return setTimeout(() => {
        if (empty) {
          const error = { message: ${JSON.stringify(CREDITS_TEXT)}, codexErrorInfo: "usageLimitExceeded" };
          write({ method: "error", params: { threadId: params.threadId, turnId, error, willRetry: false } });
          return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "failed", error } } });
        }
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
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

interface TurnLog {
  account: "default" | "second";
  turnId: string;
  marked: boolean;
  empty: boolean;
}

interface CaseResult {
  name: string;
  startAccount: string;
  endAccount: string;
  status: string;
  deliveryError: string | null;
  shownErrors: string[];
  markedTurns: TurnLog[];
}

const report: { cases: CaseResult[]; checks: { name: string; passed: boolean }[]; passed: boolean; error?: string } = {
  cases: [],
  checks: [],
  passed: false,
};

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turnLogs(): TurnLog[] {
  try {
    return readFileSync(turnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const accounts = new ProviderAccountStore(join(userData, "openbot-provider-accounts-v1.json"), accountsRoot);
await runCauseEffect(accounts.load());
const second = await runCauseEffect(accounts.create("codex"));
assert.ok(second, "The second Codex account was not created.");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  providerAccounts: accounts,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const events: AgentEvent[] = [];
agents.on("event", (event: AgentEvent) => events.push(event));

const accountOf = (agentId: string) => store.get(agentId)?.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
const fakeAccount = (accountId: string) => (accountId === second.id ? "second" : "default");
const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

async function create(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: name,
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s first turn to end`, () => idle(agent.id));
  return agent.id;
}

async function runEmptyWorkspaceTurn(name: string, agentId: string): Promise<CaseResult> {
  const startAccount = accountOf(agentId);
  writeFileSync(emptyAccountFile, fakeAccount(startAccount));
  const since = events.length;
  const before = turnLogs().length;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text: `${MARK} Please check the build.` }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  const status = await waitFor(`${name} to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" ? value : null;
  });
  await waitFor(`${name} queue to settle`, () => idle(agentId));
  const result: CaseResult = {
    name,
    startAccount,
    endAccount: accountOf(agentId),
    status,
    deliveryError: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
    shownErrors: events
      .slice(since)
      .flatMap((event) => (event.type === "error" && event.agentId === agentId ? [event.message] : [])),
    markedTurns: turnLogs()
      .slice(before)
      .filter((turn) => turn.marked),
  };
  report.cases.push(result);
  return result;
}

const showsCreditsText = (result: CaseResult) =>
  result.shownErrors.some((text) => text.includes(CREDITS_TEXT)) || (result.deliveryError ?? "").includes(CREDITS_TEXT);

try {
  await runCauseEffect(agents.initialize());

  const alone = await create("Alone");
  const aloneResult = await runEmptyWorkspaceTurn("Pool off", alone);
  pass(
    "With Pool accounts off, the agent stays on its account and the chat shows the credits text",
    aloneResult.status === "failed" &&
      aloneResult.endAccount === aloneResult.startAccount &&
      showsCreditsText(aloneResult) &&
      aloneResult.markedTurns.length === 1,
    aloneResult,
  );

  await runCauseEffect(accounts.setPool("codex", { leftOut: [] }));

  const pinned = await create("Pinned");
  await runCauseEffect(store.updateAgent({ agentId: pinned, pinnedAccountId: accountOf(pinned) }));
  const pinnedResult = await runEmptyWorkspaceTurn("Pool on, pinned account", pinned);
  pass(
    "With Pool accounts on, an agent that keeps a pinned account stays on it and the chat shows the credits text",
    pinnedResult.status === "failed" &&
      pinnedResult.endAccount === pinnedResult.startAccount &&
      showsCreditsText(pinnedResult) &&
      pinnedResult.markedTurns.length === 1,
    pinnedResult,
  );

  const pooled = await create("Pooled");
  const pooledResult = await runEmptyWorkspaceTurn("Pool on", pooled);
  const otherAccount = pooledResult.startAccount === second.id ? "default" : "second";
  pass(
    "With Pool accounts on, an empty workspace moves the agent to the other account and the message is answered",
    pooledResult.status === "completed" &&
      pooledResult.endAccount !== pooledResult.startAccount &&
      pooledResult.markedTurns.some((turn) => turn.account === otherAccount && !turn.empty),
    pooledResult,
  );
  pass("The chat does not show the credits text after the move", !showsCreditsText(pooledResult), pooledResult);
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
