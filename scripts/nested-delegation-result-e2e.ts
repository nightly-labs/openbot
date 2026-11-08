// Checks that a teammate that sends parts of a request on to other teammates answers the request
// after their answers, not with the status of the turn that sent them (#5631). Runs the real agent
// service on a temporary profile with a fake Codex app-server. The fake reads the last `STEP:<name>`
// in each turn's input and does that step: it calls `openbot.send_message`, waits until the check
// releases it, fails, or answers a text.
// 1. A asks B, and B asks C and ends its turn with a status. While C works, A gets nothing. When C
//    answers, B's next turn answers A, as a reply to A's request, once.
// 2. The same, but B's turn that reads C's answer fails: A gets the failure note, not B's status.
// 3. A asks C, and C answers at once: A gets C's answer, as before.
// `bun scripts/nested-delegation-result-e2e.ts`. Writes .openbot-build/nested-delegation-result-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ConversationMessage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/nested-delegation-result-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-nested-delegation-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const controlPath = join(root, "control.json");

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

/** What the fake does in a turn whose input names the step. */
interface FakeStep {
  /** `openbot.send_message` arguments, called before the turn answers. */
  send?: { recipientAgentIds: string[]; text: string; expectsReply: boolean };
  /** The turn waits until `released` in the control file names the step. */
  hold?: true;
  /** The turn fails instead of answering. */
  fail?: true;
  say: string;
}

interface Control {
  steps: Record<string, FakeStep>;
  released: string[];
}

/** A Codex app-server with the methods that the service calls, and the steps of `control.json`. */
const FAKE_CODEX = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const CONTROL = ${JSON.stringify(controlPath)};
const control = () => JSON.parse(readFileSync(CONTROL, "utf8"));
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
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId, step) => {
  if (step && step.fail) {
    const error = { message: "The model stopped.", codexErrorInfo: null };
    write({ method: "error", params: { threadId, turnId, error, willRetry: false } });
    write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error } } });
    return;
  }
  const text = step ? step.say : "Done.";
  const item = { type: "agentMessage", id: "message-" + turnId, text, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const run = (threadId, turnId, name, step) => {
  if (step.hold && !control().released.includes(name)) return setTimeout(() => run(threadId, turnId, name, step), 25);
  if (!step.send) return setTimeout(() => finish(threadId, turnId, step), 20);
  const id = "tool-" + turnId;
  waiting.set(id, { threadId, turnId, step });
  write({
    id,
    method: "item/tool/call",
    params: { threadId, turnId, callId: "call-" + turnId, namespace: "openbot", tool: "tool_call", arguments: { name: "openbot.send_message", arguments: step.send } },
  });
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
      const name = [...text.matchAll(/STEP:(\\w+)/g)].at(-1)?.[1];
      const step = name ? control().steps[name] : undefined;
      if (!step) return setTimeout(() => finish(params.threadId, turnId), 20);
      return run(params.threadId, turnId, name, step);
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
        finish(turn.threadId, turn.turnId, turn.step);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** One teammate message that reached A, for the report. */
interface Received {
  from: string;
  text: string;
  repliesToRequest: boolean;
}

const report: {
  scenarios: { name: string; whileWaiting?: Received[]; received: Received[] }[];
  checks: { name: string; passed: boolean; detail?: string }[];
  passed: boolean;
  error?: string;
} = { scenarios: [], checks: [], passed: false };

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

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition, ...(detail ? { detail } : {}) });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

const control: Control = { steps: {}, released: [] };
const saveControl = () => writeFileSync(controlPath, JSON.stringify(control));
saveControl();
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

const OPEN = ["queued", "starting", "running"];
/** Whether no delivery of any agent is open: every turn of the chain has ended. */
const settled = (agentIds: string[]) =>
  agentIds.every((agentId) =>
    agents.listQueue(agentId).deliveries.every((delivery) => !OPEN.includes(delivery.status)),
  );

/** The request that A sent to `recipientId` with this text. */
function requestId(fromId: string, recipientId: string, text: string): string | undefined {
  return mailbox
    .conversationMessages(fromId)
    .find(
      (message) =>
        message.exchange?.direction === "outgoing" &&
        message.exchange.recipientAgentIds.includes(recipientId) &&
        message.text === text,
    )?.exchange?.messageId;
}

/** The teammate messages that reached A as replies to `request`, and any others after `since`. */
function received(agentId: string, request: string | undefined, names: Map<string, string>, since: string) {
  return mailbox
    .conversationMessages(agentId)
    .filter(
      (message: ConversationMessage) =>
        message.exchange?.direction === "incoming" && message.createdAt >= since && message.senderAgentId,
    )
    .map((message) => ({
      from: names.get(message.senderAgentId ?? "") ?? "?",
      text: message.text,
      repliesToRequest: request !== undefined && message.replyToMessageId === request,
    }));
}

try {
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} works with teammates.`,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
    await waitFor(`${name} to be ready`, () => settled([agent.id]));
    return agent;
  };
  const a = await create("Decider");
  const b = await create("Researcher");
  const c = await create("Worker");
  const names = new Map([
    [a.id, "A"],
    [b.id, "B"],
    [c.id, "C"],
  ]);
  const all = [a.id, b.id, c.id];

  // 1. A -> B -> C. C works until the check releases it.
  control.steps = {
    a1: { send: { recipientAgentIds: [b.id], text: "STEP:b1", expectsReply: true }, say: "A waits for B." },
    b1: {
      send: { recipientAgentIds: [c.id], text: "STEP:c1", expectsReply: true },
      say: "B sent the work to C and waits for C's reply.",
    },
    c1: { hold: true, say: "C found 42. STEP:b2" },
    b2: { say: "B's final answer: 42." },
  };
  saveControl();
  let since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:a1" }, { id: "local", name: "Alex" }));
  // B's first turn has ended once C's turn runs.
  await waitFor("C's turn to run", () =>
    agents.listQueue(c.id).deliveries.some((delivery) => delivery.status === "running"),
  );
  await waitFor("B's first turn to end", () => settled([b.id]));
  const nested = requestId(a.id, b.id, "STEP:b1");
  const whileWaiting = received(a.id, nested, names, since);
  pass("A's request to B is stored", nested !== undefined);
  pass("While C works, A gets nothing from B", whileWaiting.length === 0, JSON.stringify(whileWaiting));
  control.released.push("c1");
  saveControl();
  await waitFor("the chain to end", () => settled(all) && received(a.id, nested, names, since).length > 0);
  await waitFor("the chain to stay settled", () => settled(all));
  const nestedReceived = received(a.id, nested, names, since);
  report.scenarios.push({ name: "A -> B -> C", whileWaiting, received: nestedReceived });
  pass(
    "After C answers, A gets B's final answer once, as the reply to its request",
    nestedReceived.length === 1 &&
      nestedReceived[0]?.from === "B" &&
      nestedReceived[0].repliesToRequest &&
      nestedReceived[0].text === "B's final answer: 42.",
    JSON.stringify(nestedReceived),
  );

  // 1b. C reports its part to B with send_message, no reply link and no reply wanted.
  control.steps = {
    ua1: { send: { recipientAgentIds: [b.id], text: "STEP:ub1", expectsReply: true }, say: "A waits for B." },
    ub1: {
      send: { recipientAgentIds: [c.id], text: "STEP:uc1", expectsReply: true },
      say: "B sent the work to C and waits for C's reply.",
    },
    uc1: { send: { recipientAgentIds: [b.id], text: "C found 9. STEP:ub2", expectsReply: false }, say: "C told B." },
    ub2: { say: "B's final answer: 9." },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:ua1" }, { id: "local", name: "Alex" }));
  const unlinked = await waitFor("A's request to B", () => requestId(a.id, b.id, "STEP:ub1"));
  await waitFor("the unlinked chain to end", () => settled(all) && received(a.id, unlinked, names, since).length > 0);
  await waitFor("the unlinked chain to stay settled", () => settled(all));
  const unlinkedReceived = received(a.id, unlinked, names, since);
  report.scenarios.push({ name: "A -> B -> C, C reports with no reply link", received: unlinkedReceived });
  pass(
    "When C reports with no reply link, A gets B's final answer once, as the reply to its request",
    unlinkedReceived.length === 1 &&
      unlinkedReceived[0]?.from === "B" &&
      unlinkedReceived[0].repliesToRequest &&
      unlinkedReceived[0].text === "B's final answer: 9.",
    JSON.stringify(unlinkedReceived),
  );

  // 2. The same chain, but B's turn that reads C's answer fails.
  control.steps = {
    fa1: { send: { recipientAgentIds: [b.id], text: "STEP:fb1", expectsReply: true }, say: "A waits for B." },
    fb1: {
      send: { recipientAgentIds: [c.id], text: "STEP:fc1", expectsReply: true },
      say: "B sent the work to C and waits for C's reply.",
    },
    fc1: { say: "C found 7. STEP:fb2" },
    fb2: { fail: true, say: "" },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:fa1" }, { id: "local", name: "Alex" }));
  const failedRequest = await waitFor("A's request to B", () => requestId(a.id, b.id, "STEP:fb1"));
  await waitFor(
    "the failed chain to end",
    () => settled(all) && received(a.id, failedRequest, names, since).length > 0,
  );
  await waitFor("the failed chain to stay settled", () => settled(all));
  const failedReceived = received(a.id, failedRequest, names, since);
  report.scenarios.push({ name: "A -> B -> C, B fails", received: failedReceived });
  pass(
    "When B's later turn fails, A gets the failure note as the reply, not B's status",
    failedReceived.length === 1 &&
      failedReceived[0]?.from === "B" &&
      failedReceived[0].repliesToRequest &&
      failedReceived[0].text.startsWith("Status: blocked"),
    JSON.stringify(failedReceived),
  );

  // 2b. C reports with no reply link, and B's turn that reads it fails.
  control.steps = {
    ga1: { send: { recipientAgentIds: [b.id], text: "STEP:gb1", expectsReply: true }, say: "A waits for B." },
    gb1: {
      send: { recipientAgentIds: [c.id], text: "STEP:gc1", expectsReply: true },
      say: "B sent the work to C and waits for C's reply.",
    },
    gc1: { send: { recipientAgentIds: [b.id], text: "C found 5. STEP:gb2", expectsReply: false }, say: "C told B." },
    gb2: { fail: true, say: "" },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:ga1" }, { id: "local", name: "Alex" }));
  const unlinkedFailed = await waitFor("A's request to B", () => requestId(a.id, b.id, "STEP:gb1"));
  await waitFor(
    "the unlinked failed chain to end",
    () => settled(all) && received(a.id, unlinkedFailed, names, since).length > 0,
  );
  await waitFor("the unlinked failed chain to stay settled", () => settled(all));
  const unlinkedFailedReceived = received(a.id, unlinkedFailed, names, since);
  report.scenarios.push({ name: "A -> B -> C, no reply link, B fails", received: unlinkedFailedReceived });
  pass(
    "When C reports with no reply link and B's later turn fails, A gets the failure note",
    unlinkedFailedReceived.length === 1 &&
      unlinkedFailedReceived[0]?.from === "B" &&
      unlinkedFailedReceived[0].repliesToRequest &&
      unlinkedFailedReceived[0].text.startsWith("Status: blocked"),
    JSON.stringify(unlinkedFailedReceived),
  );

  // 3. A -> C, one step: the result comes as before.
  control.steps = {
    sa1: { send: { recipientAgentIds: [c.id], text: "STEP:sc1", expectsReply: true }, say: "A waits for C." },
    sc1: { say: "C's direct answer." },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:sa1" }, { id: "local", name: "Alex" }));
  const direct = await waitFor("A's request to C", () => requestId(a.id, c.id, "STEP:sc1"));
  await waitFor("the direct request to end", () => settled(all) && received(a.id, direct, names, since).length > 0);
  const directReceived = received(a.id, direct, names, since);
  report.scenarios.push({ name: "A -> C", received: directReceived });
  pass(
    "A one-step request still gets the teammate's answer",
    directReceived.length === 1 &&
      directReceived[0]?.repliesToRequest === true &&
      directReceived[0].text === "C's direct answer.",
    JSON.stringify(directReceived),
  );

  // 4. A -> C, and C ends its turn with no text: A gets a note, not silence.
  control.steps = {
    xa1: { send: { recipientAgentIds: [c.id], text: "STEP:xc1", expectsReply: true }, say: "A waits for C." },
    xc1: { say: "" },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:xa1" }, { id: "local", name: "Alex" }));
  const silentDirect = await waitFor("A's request to C", () => requestId(a.id, c.id, "STEP:xc1"));
  await waitFor(
    "the silent request to end",
    () => settled(all) && received(a.id, silentDirect, names, since).length > 0,
  );
  await waitFor("the silent request to stay settled", () => settled(all));
  const silentDirectReceived = received(a.id, silentDirect, names, since);
  report.scenarios.push({ name: "A -> C, C ends with no text", received: silentDirectReceived });
  pass(
    "When C ends with no text, A gets the no-answer note",
    silentDirectReceived.length === 1 &&
      silentDirectReceived[0]?.from === "C" &&
      silentDirectReceived[0].repliesToRequest &&
      silentDirectReceived[0].text.includes("the teammate ended its turn with no answer"),
    JSON.stringify(silentDirectReceived),
  );

  // 5. A -> B -> C, and C ends with no text: B gets the note, and A gets B's answer after it.
  control.steps = {
    ya1: { send: { recipientAgentIds: [b.id], text: "STEP:yb1", expectsReply: true }, say: "A waits for B." },
    yb1: {
      send: { recipientAgentIds: [c.id], text: "STEP:yc1", expectsReply: true },
      say: "B sent the work to C and waits for C's reply.",
    },
    yc1: { say: "" },
  };
  saveControl();
  since = new Date().toISOString();
  await runCauseEffect(agents.sendMessage({ agentId: a.id, text: "STEP:ya1" }, { id: "local", name: "Alex" }));
  const silentNested = await waitFor("A's request to B", () => requestId(a.id, b.id, "STEP:yb1"));
  await waitFor("the silent chain to end", () => settled(all) && received(a.id, silentNested, names, since).length > 0);
  await waitFor("the silent chain to stay settled", () => settled(all));
  const silentNestedReceived = received(a.id, silentNested, names, since);
  report.scenarios.push({ name: "A -> B -> C, C ends with no text", received: silentNestedReceived });
  pass(
    "When C ends with no text, A gets B's later answer once, not B's status",
    silentNestedReceived.length === 1 &&
      silentNestedReceived[0]?.from === "B" &&
      silentNestedReceived[0].repliesToRequest &&
      silentNestedReceived[0].text === "Done.",
    JSON.stringify(silentNestedReceived),
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
