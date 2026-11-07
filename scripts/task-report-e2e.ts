// Checks `report_to_agent` (#4445): a task that the agent started with `start_task` sends its result,
// a blocker or a question to the agent's own chat, and OpenBot delivers it there as a new turn. A task
// started with notify that ends, fails or is stopped without a report sends a short end notice. Runs the real agent
// service, tool router and mailbox on a temporary profile with a fake Codex app-server. The fake calls
// the OpenBot tools that the last `<<CALLS[...]CALLS>>` of a turn's input names, else the last
// `<<TASK[...]TASK>>`, logs each result, and then answers. The check asserts that a report and an end
// notice each come to the own chat once, as a new turn with the task framing, that a reported task
// sends no end notice, that a repeated call sends no second report, that the tool fails outside a
// task, and that a user task and a routine run send no notice.
// `bun scripts/task-report-e2e.ts`. Writes .openbot-build/task-report-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ConversationMessage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/task-report-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-task-report-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const PROVIDER_ERROR = "The fake provider stopped.";
const FRAMING = "A task that you started with openbot.start_task sent this to your own chat.";
const TASK_ONLY = "Only an open task that you started with start_task can report";

interface FakeCall {
  tool: "start_task" | "report_to_agent";
  arguments: Record<string, string | boolean>;
  callId?: string;
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;
const taskCalls = (...items: FakeCall[]) => `<<TASK${JSON.stringify(items)}TASK>>`;
const startTask = (title: string, brief: string, notify: boolean): FakeCall => ({
  tool: "start_task",
  arguments: notify ? { title, brief, notify } : { title, brief },
});
const reportToAgent = (kind: string, text: string, callId?: string): FakeCall => ({
  tool: "report_to_agent",
  arguments: { kind, text },
  ...(callId ? { callId } : {}),
});

/**
 * A Codex app-server with the methods that the service calls. A turn calls, one at a time, the
 * OpenBot tools that the last `<<CALLS[...]CALLS>>` of its input names, else the last
 * `<<TASK[...]TASK>>`, logs each result, then answers "All good.". An input without `<<CALLS` that has
 * `PROVIDER-FAIL` ends the turn failed, and one that has `HOLD` runs until it is interrupted.
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
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const last = (text, pattern) => {
  const found = [...text.matchAll(pattern)];
  return found.length ? JSON.parse(found[found.length - 1][1]) : null;
};
const finish = (turn) => {
  const { threadId, turnId } = turn;
  if (turn.hold) return;
  if (turn.providerFail) {
    write({ method: "error", params: { threadId, turnId, error: { message: ${JSON.stringify(PROVIDER_ERROR)} }, willRetry: false } });
    return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed" } } });
  }
  const item = { type: "agentMessage", id: "message-" + turnId, text: "All good.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return setTimeout(() => finish(turn), 20);
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, { turn, tool: call.tool });
  write({
    id,
    method: "item/tool/call",
    params: { threadId: turn.threadId, turnId: turn.turnId, callId: call.callId || "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments || {} },
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
      log({ method: "turn/start", threadId: params.threadId, turnId, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const named = last(text, /<<CALLS([\\s\\S]*?)CALLS>>/g);
      const brief = named ? "" : text;
      const turnCalls = named || last(text, /<<TASK([\\s\\S]*?)TASK>>/g) || [];
      return callNext({ threadId: params.threadId, turnId, calls: turnCalls, hold: brief.includes("HOLD"), providerFail: brief.includes("PROVIDER-FAIL") });
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
        const { turn, tool } = waiting.get(message.id);
        waiting.delete(message.id);
        log({ method: "tool-result", turnId: turn.turnId, threadId: turn.threadId, tool, result: message.result ?? null, error: message.error ?? null });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface LogEntry {
  method: string;
  threadId?: string;
  turnId: string;
  text?: string;
  tool?: string;
  result?: { success: boolean; contentItems: { type: string; text: string }[] } | null;
}

const report: {
  checks: { name: string; passed: boolean }[];
  ownChat: string[];
  queue: string[];
  ownChatInputs: string[];
  passed: boolean;
  error?: string;
} = { checks: [], ownChat: [], queue: [], ownChatInputs: [], passed: false };

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

async function waitFor<T>(
  label: string,
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const settle = () => new Promise((done) => setTimeout(done, 1_500));

function fakeEntries(): LogEntry[] {
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

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
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

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

const ownChat = async (agentId: string): Promise<ConversationMessage[]> =>
  (await runCauseEffect(agents.readConversation(agentId))).messages;
const header = (kind: string, title: string) => `Task ${kind} from "${title}"`;
const withHeader = (messages: ConversationMessage[], kind: string, title: string) =>
  messages.filter((message) => message.text.includes(header(kind, title)));
const taskEnds = (messages: ConversationMessage[]) =>
  messages.filter((message) => message.text.includes("Task end from"));
const findTask = (agentId: string, title: string) =>
  agents.listTasks(agentId).tasks.find((task) => task.title === title);
const quiet = (agentId: string) => agents.listQueue(agentId).deliveries.every((delivery) => ended(delivery.status));

async function startedTask(agentId: string, title: string, brief: string, notify = true) {
  await runCauseEffect(agents.sendMessage({ agentId, text: `Start it. ${calls(startTask(title, brief, notify))}` }));
  return waitFor(`task ${title}`, () => findTask(agentId, title));
}

async function endedTask(agentId: string, title: string) {
  return waitFor(`task ${title} to end`, () => {
    const task = findTask(agentId, title);
    return task?.outcome && task.activeTurnId === null ? task : null;
  });
}

function turnsOn(threadId: string | undefined, text: string) {
  return fakeEntries().filter(
    (entry) => entry.method === "turn/start" && entry.threadId === threadId && entry.text?.includes(text),
  );
}

let agentId = "";
let mainThread: string | undefined;
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Lead",
      description: "Starts tasks.",
      avatarSeed: "lead",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  agentId = agent.id;
  await waitFor("first turn", () => quiet(agentId));
  mainThread = await waitFor(
    "own chat thread",
    () => fakeEntries().find((entry) => entry.method === "turn/start" && entry.text === "Hello.")?.threadId,
  );

  // A result: it comes to the own chat once, as a new turn with the task framing. No end notice follows.
  await startedTask(
    agentId,
    "Build check",
    `Check the build. ${taskCalls(reportToAgent("result", "The build passed."))}`,
  );
  const result = await waitFor(
    "result report",
    async () => withHeader(await ownChat(agentId), "result", "Build check")[0],
  );
  pass("The result comes to the own chat", result.text.includes("The build passed."), result.text);
  const resultTurn = await waitFor("result turn", () => turnsOn(mainThread, header("result", "Build check"))[0]);
  pass(
    "The result runs as a new turn of the own chat with the task framing",
    resultTurn.text?.includes(FRAMING) === true,
  );
  await endedTask(agentId, "Build check");
  await waitFor("own chat idle", () => quiet(agentId));
  await settle();
  let messages = await ownChat(agentId);
  pass("The result comes once", withHeader(messages, "result", "Build check").length === 1);
  pass("A reported task sends no end notice", withHeader(messages, "end", "Build check").length === 0);

  // A question and a repeated blocker call: each comes once.
  await startedTask(agentId, "Ask", `Ask. ${taskCalls(reportToAgent("question", "Which branch?"))}`);
  await waitFor("question report", async () => withHeader(await ownChat(agentId), "question", "Ask")[0]);
  await startedTask(
    agentId,
    "Blocked",
    `Try. ${taskCalls(reportToAgent("blocker", "No access.", "same-call"), reportToAgent("blocker", "No access.", "same-call"))}`,
  );
  await waitFor("blocker report", async () => withHeader(await ownChat(agentId), "blocker", "Blocked")[0]);
  await endedTask(agentId, "Ask");
  await endedTask(agentId, "Blocked");
  await waitFor("own chat idle", () => quiet(agentId));
  await settle();
  messages = await ownChat(agentId);
  pass("A question comes to the own chat", withHeader(messages, "question", "Ask").length === 1);
  pass("A repeated call sends one report", withHeader(messages, "blocker", "Blocked").length === 1);

  // No report: the task ends, fails or is stopped, and the own chat gets one end notice.
  await startedTask(agentId, "Quiet", "Do the work.");
  const quietNotice = await waitFor("end notice", async () => withHeader(await ownChat(agentId), "end", "Quiet")[0]);
  pass(
    "A task that ends without a report sends an end notice",
    quietNotice.text.includes("ended and sent no report"),
    quietNotice.text,
  );
  const noticeTurn = await waitFor("end notice turn", () => turnsOn(mainThread, header("end", "Quiet"))[0]);
  pass("The end notice runs as a new turn with the task framing", noticeTurn.text?.includes(FRAMING) === true);

  await startedTask(agentId, "Broken", "Do the work. PROVIDER-FAIL");
  const failedNotice = await waitFor(
    "failed notice",
    async () => withHeader(await ownChat(agentId), "end", "Broken")[0],
  );
  pass(
    "A failed task sends a failed notice",
    failedNotice.text.includes("failed and sent no report"),
    failedNotice.text,
  );

  const held = await startedTask(agentId, "Held", "Wait. HOLD");
  await waitFor("held task to run", () => findTask(agentId, "Held")?.activeTurnId);
  await runCauseEffect(agents.stopTask({ agentId, taskId: held.id }));
  const stoppedNotice = await waitFor(
    "stopped notice",
    async () => withHeader(await ownChat(agentId), "end", "Held")[0],
  );
  pass("A stopped task sends a stopped notice", stoppedNotice.text.includes("was stopped"), stoppedNotice.text);
  await waitFor("own chat idle", () => quiet(agentId));
  await settle();
  messages = await ownChat(agentId);
  pass(
    "Each end notice comes once",
    ["Quiet", "Broken", "Held"].every((title) => withHeader(messages, "end", title).length === 1),
  );

  // The own chat cannot report, and a task started without notify, a user task or a routine run sends no notice.
  const before = taskEnds(messages).length;
  await startedTask(agentId, "Silent", "Do the work.", false);
  await endedTask(agentId, "Silent");
  await runCauseEffect(
    agents.sendMessage({ agentId, text: `Report. ${calls(reportToAgent("result", "Not a task."))}` }),
  );
  const refused = await waitFor("refused report", () =>
    fakeEntries().find(
      (entry) => entry.method === "tool-result" && entry.tool === "report_to_agent" && entry.threadId === mainThread,
    ),
  );
  const refusedText = refused.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  pass("The own chat cannot report", refused.result?.success === false && refusedText.includes(TASK_ONLY), refused);

  const userTask = await runCauseEffect(agents.startTask({ agentId, text: "Do the user's work." }));
  await endedTask(agentId, userTask.title);
  const routine = agents.createRoutine({
    agentId,
    name: "Daily",
    instruction: "Check the disk.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(agents.updateAgent({ agentId, allowAutomation: true }));
  const run = await runCauseEffect(agents.runRoutineFromAutomation({ agentId, routineId: routine.id, payload: "" }));
  const runDelivery = run.deliveryId;
  assert.ok(runDelivery, "The routine run has no delivery.");
  await waitFor("routine run", () => ended(mailbox.getDelivery(runDelivery)?.delivery.status));
  await waitFor("own chat idle", () => quiet(agentId));
  await settle();
  messages = await ownChat(agentId);
  pass(
    "The own chat gets no report from itself",
    !messages.some((message) => message.text.includes("Task result from") && message.text.includes("Not a task.")),
  );
  pass("A task started without notify sends no end notice", withHeader(messages, "end", "Silent").length === 0);
  pass(
    "A user task and a routine run send no end notice",
    taskEnds(messages).length === before,
    taskEnds(messages).map((m) => m.text),
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (agentId) {
    report.ownChat = (await ownChat(agentId).catch(() => [])).map((message) => message.text);
    report.ownChatInputs = fakeEntries()
      .filter((entry) => entry.method === "turn/start" && entry.threadId === mainThread)
      .map((entry) => entry.text ?? "");
    report.queue = agents.listQueue(agentId).deliveries.map((delivery) => JSON.stringify(delivery).slice(0, 400));
  }
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"} ${report.checks.length} checks ${join(OUT, "report.json")}\n`,
  );
  if (report.error) process.stdout.write(`${report.error}\n`);
}
