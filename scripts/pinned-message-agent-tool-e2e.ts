// Checks the `pin_message` agent tool through the real agent service and tool router, on a temporary
// profile with a fake Codex app-server. The fake has its own thread ids, as a real provider does, and
// calls the tool through `tool_call`. It checks that the agent pins in its own chat and in a side
// thread, that a quote skips the user's request that also contains it, that an unpin by quote finds
// the pinned message when a newer message has the same text, and that the agent cannot unpin a
// person's pin.
// `bun scripts/pinned-message-agent-tool-e2e.ts`. Writes .openbot-build/pinned-message-agent-tool-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pinned-message-agent-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pin-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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

const CALL_MARK = "PIN-CALL";
const PERSON = { id: "local", name: "Alex" };
const DECISION = "We decided: ship on Friday.";
const QUOTE = "ship on Friday";

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `PIN-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `openbot.<__tool>` with the rest of that JSON
 * through `tool_call`, logs the result, and ends. The last call in the input is the current one. Other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const calls = text.includes(${JSON.stringify(CALL_MARK)}) ? [...text.matchAll(/<<ARGS([\\s\\S]*?)ARGS>>/g)] : [];
      const match = calls.at(-1);
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      // The packet carries the request as JSON text, so its quotes arrive escaped.
      const { __tool, ...args } = JSON.parse(match[1].replace(/\\\\"/g, '"'));
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot." + __tool, arguments: args },
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
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

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

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

/** Waits for a state of the service or the fake's log. */
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
  calls: { name: string; success: boolean; text: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
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
  timezone: () => "UTC",
});

/** Waits until no chat or side thread of the agent has a turn that runs or waits to start. */
function idle(agentId: string) {
  return waitFor(
    "the turns to end",
    () =>
      agents
        .listQueue(agentId)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)) &&
      agents.listTasks(agentId).tasks.every((task) => task.state !== "running" && task.state !== "queued"),
  );
}

const callText = (args: { quote?: string; pinned?: boolean }) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "pin_message", ...args })}ARGS>>`;

/** Sends `text` as the person to the agent's own chat, with no tool call. */
async function say(agentId: string, text: string) {
  await runCauseEffect(agents.sendMessage({ agentId, text }, PERSON));
  await idle(agentId);
}

/** Sends a message with a tool call as the person, to the agent's own chat or to a new side thread. */
async function call(name: string, agentId: string, text: string, where: "chat" | "new-thread" = "chat") {
  const before = toolLogs().length;
  if (where === "chat") await runCauseEffect(agents.sendMessage({ agentId, text }, PERSON));
  else await runCauseEffect(agents.startTask({ agentId, text }, PERSON));
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  await idle(agentId);
  const result = {
    success: entry.result?.success === true,
    text: entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error),
  };
  report.calls.push({ name, ...result });
  return result;
}

const pins = (agentId: string) => agents.listPinnedMessages(agentId).pins;

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Planner",
      description: "Planner keeps the plan.",
      avatarSeed: "planner",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(agent.id);
  await say(agent.id, DECISION);

  // 1. A quote pins the older message, not the user's request that also quotes it.
  const pinned = await call("pin by quote", agent.id, `Pin the message "${QUOTE}". ${callText({ quote: QUOTE })}`);
  const decision = pins(agent.id).find((pin) => pin.text === DECISION);
  pass(
    "A quote pins the message that it names in the agent's own chat",
    pinned.success && decision?.pinnedBy.kind === "agent" && decision.taskId === null && pins(agent.id).length === 1,
    `${pinned.text} ${JSON.stringify(pins(agent.id))}`,
  );
  assert.ok(decision);

  // 2. An unpin by quote finds the pinned message, also when a newer message has the same text.
  await say(agent.id, `Reminder: ${QUOTE} stays the plan.`);
  const unpinned = await call(
    "unpin by quote",
    agent.id,
    `Unpin "${QUOTE}". ${callText({ quote: QUOTE, pinned: false })}`,
  );
  pass(
    "An unpin by quote removes the pin under a newer unpinned copy",
    unpinned.success && pins(agent.id).length === 0,
    `${unpinned.text} ${JSON.stringify(pins(agent.id))}`,
  );

  // 3. A quote that only the request has is refused, and pins nothing.
  const missing = await call("quote only in the request", agent.id, `Pin "zebra". ${callText({ quote: "zebra" })}`);
  pass(
    "A quote that only the request contains pins nothing",
    !missing.success && pins(agent.id).length === 0,
    missing.text,
  );

  // 4. With no quote, the current user message is the target.
  const current = await call("pin the request", agent.id, `Pin this message. ${callText({})}`);
  pass(
    "With no quote, the agent pins the current user message",
    current.success && pins(agent.id).some((pin) => pin.text.startsWith("Pin this message.") && pin.author === "user"),
    `${current.text} ${JSON.stringify(pins(agent.id))}`,
  );

  // 5. The agent cannot unpin a person's pin.
  await Effect.runPromise(
    agents.setMessagePinned(
      { agentId: agent.id, messageId: decision.messageId, pinned: true },
      { kind: "person", sender: null },
    ),
  );
  const personPin = await call(
    "unpin a person's pin",
    agent.id,
    `Unpin "We decided". ${callText({ quote: "We decided", pinned: false })}`,
  );
  pass(
    "The agent cannot unpin a person's pin",
    !personPin.success &&
      personPin.text.includes("A person pinned") &&
      pins(agent.id).some((pin) => pin.messageId === decision.messageId && pin.pinnedBy.kind === "person"),
    personPin.text,
  );

  // 6. In a side thread, the pin belongs to that thread.
  const inThread = await call("pin in a side thread", agent.id, `Thread note. ${callText({})}`, "new-thread");
  const task = agents.listTasks(agent.id).tasks.find((candidate) => candidate.origin !== "agent");
  pass(
    "The agent pins in a side thread, and the pin names that thread",
    inThread.success &&
      task !== undefined &&
      pins(agent.id).some((pin) => pin.taskId === task.id && pin.text.startsWith("Thread note.")),
    `${inThread.text} ${JSON.stringify(pins(agent.id))}`,
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
