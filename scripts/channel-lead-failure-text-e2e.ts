import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-lead-failure-text-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-lead-failure-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const turnStart = (message) => {
  const params = message.params || {};
  const threadId = params.threadId;
  const turnId = "turn-" + process.pid + "-" + (++turns);
  const text = (params.input || []).map((item) => item.text || "").join("\\n");
  write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
  write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
  if (text.includes("ROUTE-EXIT")) return setTimeout(() => process.exit(1), 20);
  const failedThenExited = /ROUTE-FAIL-EXIT cause:([a-z_]+)/.exec(text);
  if (failedThenExited) {
    const error = { message: "The upstream service refused the call." };
    write({ method: "error", params: { threadId, turnId, willRetry: false, causeCode: failedThenExited[1], error } });
    return setTimeout(() => process.exit(1), 20);
  }
  const failure = /ROUTE-FAIL cause:([a-z_]+)/.exec(text);
  if (failure) {
    const error = { message: "The upstream service refused the call." };
    write({ method: "error", params: { threadId, turnId, willRetry: false, causeCode: failure[1], error } });
    return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error } } });
  }
  const item = { type: "agentMessage", id: "message-" + turnId, text: "All good.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "Primary" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": return turnStart(message);
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

interface CaseResult {
  name: string;
  state: string;
  ownerAgentId: string | null;
  error: string | null;
  coordinatorMessages: string[];
}

const report: { cases: CaseResult[]; passed: boolean; checkedAt?: string; error?: string } = {
  cases: [],
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

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

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

async function createAgent(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks channel routing failures.",
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

async function route(name: string, text: string, leadId: string, memberId: string): Promise<CaseResult> {
  const person = { id: "local", name: "Alex" };
  const channelId = randomUUID();
  await runCauseEffect(
    agents.channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name,
          title: "",
          instructions: "",
          members: [{ agentId: leadId }, { agentId: memberId }],
          leadAgentId: leadId,
        },
      },
      person,
    ),
  );
  await runCauseEffect(
    agents.channels.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text,
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      person,
    ),
  );
  const task = await waitFor(`the ${name} request to stop`, () =>
    agents.channels.store.tasks(channelId).find((item) => item.parentTaskId === null && item.state === "paused"),
  );
  const result: CaseResult = {
    name,
    state: task.state,
    ownerAgentId: task.ownerAgentId,
    error: task.error,
    coordinatorMessages: agents.channels.store
      .messages(channelId)
      .filter((entry) => entry.author.kind === "coordinator")
      .map((entry) => entry.message.text),
  };
  report.cases.push(result);
  return result;
}

const CASES = [
  { name: "billing", text: "ROUTE-FAIL cause:billing", shown: sourceText("error.backend.channelLeadBilling") },
  {
    name: "provider internal error",
    text: "ROUTE-FAIL cause:provider_internal_error",
    shown: sourceText("error.backend.channelLeadProviderError"),
  },
  {
    name: "content blocked",
    text: "ROUTE-FAIL cause:content_blocked",
    shown: sourceText("error.backend.channelLeadBlocked"),
  },
  {
    name: "empty answer",
    text: "ROUTE-FAIL cause:empty_answer",
    shown: sourceText("error.backend.channelLeadNoAnswer"),
  },
  {
    name: "permission",
    text: "ROUTE-FAIL cause:permission",
    shown: sourceText("error.backend.channelLeadNotPermitted"),
  },
  {
    name: "context too long",
    text: "ROUTE-FAIL cause:context_too_long",
    shown: sourceText("error.backend.channelRoutingTooLong"),
  },
  {
    name: "provider timeout",
    text: "ROUTE-FAIL cause:timeout",
    shown: sourceText("error.backend.channelLeadTimedOut"),
  },
  { name: "process exit", text: "ROUTE-EXIT", shown: sourceText("error.backend.channelLeadStopped") },
  {
    name: "unknown error, then process exit",
    text: "ROUTE-FAIL-EXIT cause:unknown",
    shown: sourceText("error.backend.channelLeadStopped"),
  },
  { name: "unknown cause", text: "ROUTE-FAIL cause:unknown", shown: sourceText("error.backend.channelLeadFailed") },
] as const;

try {
  await runCauseEffect(agents.initialize());
  const lead = await createAgent("Lead");
  const writer = await createAgent("Writer");
  for (const item of CASES) {
    const result = await route(item.name, item.text, lead.id, writer.id);
    assert.equal(result.ownerAgentId, null, `${item.name}: the request has no owner.`);
    assert.equal(result.error, item.shown, `${item.name}: the stopped request shows its reason.`);
    assert.deepEqual(result.coordinatorMessages, [item.shown], `${item.name}: the Coordinator posts the reason.`);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.cases) process.stdout.write(`${entry.name}: ${entry.error}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
