// Runs three native task turns through AgentService and a local Codex protocol stub.
// Uses a temporary profile and home. No production account or network is needed.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/activity-inbox-runtime-pilot");
const root = await mkdtemp(join(tmpdir(), "openbot-turn-input-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/**
 * A Codex app-server with the methods that the service calls. A turn runs for `turnMs` of
 * `control.json`, and reports a small part of the context window, so no compaction starts.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/name/set": return write({ id: message.id, result: {} });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 1000 }, modelContextWindow: 100000 } } });
      const text = JSON.stringify(params.input || []);
      if (text.includes("PILOT-APPROVAL")) {
        setTimeout(() => write({ id: 8181, method: "item/commandExecution/requestApproval", params: { threadId: params.threadId, turnId, itemId: "pilot-item", command: "printf pilot", reason: "Pilot approval" } }), 100);
        return;
      }
      if (text.includes("PILOT-FAILURE")) {
        setTimeout(() => write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "failed", error: { message: "Pilot failure" } } } }), 125);
        return;
      }
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, control().turnMs);
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
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** One `turn/start` that OpenBot sent: its provider thread and the text of its input. */
interface TurnStart {
  threadId: string;
  text: string;
}

const report: {
  observed?: { outcome: string | undefined; count: number; owner: string; nextAction: string | undefined }[];
  approvals?: number;
  passed: boolean;
  error?: string;
} = { passed: false };

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

function turnStarts(): TurnStart[] {
  let lines: string[];
  try {
    lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  return lines.flatMap((line) => {
    const entry = JSON.parse(line);
    if (!isRecord(entry) || getString(entry, "method") !== "turn/start" || !isRecord(entry.params)) return [];
    const threadId = getString(entry.params, "threadId");
    const input = Array.isArray(entry.params.input) ? entry.params.input : [];
    const text = input.flatMap((item) => (isRecord(item) && getString(item, "text")) || []).join("\n");
    return threadId ? [{ threadId, text }] : [];
  });
}

/** Waits for a state of the service or of the fake Codex. */
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

try {
  await runCauseEffect(agents.initialize());

  await writeFile(controlPath, JSON.stringify({ turnMs: 125 }));
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Inbox Pilot",
      description: "Local test",
      avatarSeed: "inbox-pilot",
      avatarHue: null,
      initialMessage: "Pilot startup.",
    }),
  );
  await waitFor("main turn", () => turnStarts().length);
  const approvalEvents: import("@openbot/contracts/ipc").AgentApproval[] = [];
  agents.on("event", (event) => {
    if (event.type === "approval") approvalEvents.push(event.approval);
  });
  const completed = await runCauseEffect(agents.startTask({ agentId: agent.id, text: "PILOT-COMPLETE" }));
  await waitFor("completed inbox item", () =>
    agents.listActivityInbox().items.find((item) => item.threadId === completed.threadId),
  );
  const failed = await runCauseEffect(agents.startTask({ agentId: agent.id, text: "PILOT-FAILURE" }));
  await waitFor("failed inbox item", () =>
    agents.listActivityInbox().items.find((item) => item.threadId === failed.threadId),
  );
  const pending = await runCauseEffect(agents.startTask({ agentId: agent.id, text: "PILOT-APPROVAL" }));
  await waitFor("pending approval", () => approvalEvents.find((approval) => approval.threadId === pending.threadId));
  const approvals = agents
    .getLocalAttention(agent.id)
    .approvals.filter((approval) => approval.threadId === pending.threadId);
  assert.equal(approvals.length, 1);
  assert.equal(approvalEvents.filter((event) => event.threadId === pending.threadId).length, 1);
  const observed = [completed, failed].map((task, i) => {
    const rows = agents.listActivityInbox().items.filter((item) => item.threadId === task.threadId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceOutcome, i === 0 ? "completed" : "failed");
    assert.equal(rows[0]?.assignedOwnerId ?? rows[0]?.agentId, agent.id);
    assert.ok(rows[0]?.nextAction);
    return { outcome: rows[0]?.sourceOutcome, count: rows.length, owner: agent.name, nextAction: rows[0]?.nextAction };
  });
  report.observed = observed;
  report.approvals = approvals.length;
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
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
