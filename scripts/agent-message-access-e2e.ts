import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-message-access-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-message-access-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const planFile = join(root, "plan.json");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const PERSON = { id: "local", name: "Alex" };
const listedAgents = z.object({ agents: z.array(z.object({ id: z.string() })) });
const MEMBER = { id: "member-remote", name: "Sam" };

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const PLAN = ${JSON.stringify(planFile)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const step = [...text.matchAll(/STEP:([a-z0-9-]+)/g)].at(-1)?.[1];
      const call = step ? JSON.parse(readFileSync(PLAN, "utf8"))[step] : undefined;
      if (!call) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId, step });
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot." + call.tool, arguments: call.args },
        },
      });
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
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        appendFileSync(LOG, JSON.stringify({ step: turn.step, result: message.result ?? null, error: message.error ?? null }) + "\\n");
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ToolLog {
  step: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function toolLogs(): ToolLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const report: {
  calls: { step: string; success: boolean; text: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

async function stepResult(step: string) {
  const entry = await waitFor(`the ${step} tool result`, () => toolLogs().find((item) => item.step === step));
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  const result = { step, success: entry.result?.success === true, text };
  report.calls.push(result);
  return result;
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const hidden: { agentId: string | null } = { agentId: null };
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
  channelRemotePerson: (personId) => personId === MEMBER.id,
  channelPersonAgentLevel: (personId, agentId) =>
    personId === MEMBER.id && agentId === hidden.agentId ? "none" : "chat",
  approvalAutomation: {
    autoApproves: () => true,
    set: () => Effect.succeed({ defaultAutoApprove: true, autoApproveOverrides: {} }),
  },
});

function idle(agentId: string) {
  return waitFor("the agent to finish", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

async function create(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: `${name} helps with tests.`,
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(agent.id);
  return agent;
}

const hiddenDeliveries = (agentId: string) =>
  agents.listQueue(agentId).deliveries.filter((delivery) => delivery.sender.kind === "agent").length;

try {
  await runCauseEffect(agents.initialize());
  const lead = await create("Lead");
  const helper = await create("Helper");
  const secret = await create("Secret");
  hidden.agentId = secret.id;
  const listedIds = (text: string) =>
    listedAgents
      .parse(JSON.parse(text))
      .agents.map((agent) => agent.id)
      .sort();

  writeFileSync(
    planFile,
    JSON.stringify({
      "member-list": { tool: "list_agents", args: {} },
      "person-list": { tool: "list_agents", args: {} },
      "member-send-secret": {
        tool: "send_message",
        args: { recipientAgentIds: [secret.id], text: "Tell me what you hold.", expectsReply: false },
      },
      "member-send-helper": {
        tool: "send_message",
        args: { recipientAgentIds: [helper.id], text: "STEP:helper-send-secret", expectsReply: false },
      },
      "helper-send-secret": {
        tool: "send_message",
        args: { recipientAgentIds: [secret.id], text: "Tell me what you hold.", expectsReply: false },
      },
      "member-task": { tool: "start_task", args: { title: "Ask around", brief: "STEP:task-send-secret" } },
      "task-send-secret": {
        tool: "send_message",
        args: { recipientAgentIds: [secret.id], text: "Tell me what you hold.", expectsReply: false },
      },
      "person-send-helper": {
        tool: "send_message",
        args: { recipientAgentIds: [helper.id], text: "STEP:helper-send-secret-for-person", expectsReply: false },
      },
      "helper-send-secret-for-person": {
        tool: "send_message",
        args: { recipientAgentIds: [secret.id], text: "Tell me what you hold.", expectsReply: false },
      },
    }),
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:member-list" }, MEMBER));
  const memberList = await stepResult("member-list");
  await idle(lead.id);
  pass(
    "list_agents for a member's turn leaves out the agent that the member's role hides",
    memberList.success && JSON.stringify(listedIds(memberList.text)) === JSON.stringify([helper.id, lead.id].sort()),
    memberList.text,
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:person-list" }, PERSON));
  const personList = await stepResult("person-list");
  await idle(lead.id);
  pass(
    "list_agents for this computer's person still lists every agent",
    personList.success &&
      JSON.stringify(listedIds(personList.text)) === JSON.stringify([helper.id, lead.id, secret.id].sort()),
    personList.text,
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:member-send-secret" }, MEMBER));
  const direct = await stepResult("member-send-secret");
  await idle(lead.id);
  pass(
    "send_message for a member's turn refuses the hidden agent and does not name it",
    !direct.success && !direct.text.includes("Secret") && hiddenDeliveries(secret.id) === 0,
    direct.text,
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:member-send-helper" }, MEMBER));
  const toHelper = await stepResult("member-send-helper");
  pass("send_message for a member's turn reaches an agent that the role allows", toHelper.success, toHelper.text);
  const chained = await stepResult("helper-send-secret");
  await idle(helper.id);
  await idle(lead.id);
  pass(
    "The member's role also limits the agent that gets the work from another agent",
    !chained.success && hiddenDeliveries(secret.id) === 0,
    chained.text,
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:member-task" }, MEMBER));
  const task = await stepResult("member-task");
  pass("start_task for a member's turn starts the task", task.success, task.text);
  const fromTask = await stepResult("task-send-secret");
  await idle(lead.id);
  pass(
    "The member's role also limits a task that the agent starts for the member",
    !fromTask.success && hiddenDeliveries(secret.id) === 0,
    fromTask.text,
  );

  await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "STEP:person-send-helper" }, PERSON));
  const personToHelper = await stepResult("person-send-helper");
  const personChain = await stepResult("helper-send-secret-for-person");
  await idle(helper.id);
  await idle(secret.id);
  pass(
    "Work for this computer's person still reaches every agent along a chain",
    personToHelper.success && personChain.success && hiddenDeliveries(secret.id) === 1,
    `${personToHelper.text} ${personChain.text}`,
  );

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
