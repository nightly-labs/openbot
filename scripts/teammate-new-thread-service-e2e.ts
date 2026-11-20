// Drives the real `send_message` branch of the tool router through real provider turns: the agent
// service, drain scheduler, task lanes, mailbox and turn relay are the ones the app runs, on a
// temporary profile with a fake Codex app-server process (#8134). The fake answers the protocol and
// issues the tool calls that a model would, so every check below runs the shipped dispatch path, not
// a copy of it. No production account, provider or network is touched: the only provider is the
// fake, and the profile is a temporary directory.
//
// 1. A plain turn still answers (the harness works).
// 2. A `send_message` with `newThread` starts the recipient's thread through the router, the drain
//    runs the brief in the task's lane, and the automatic result of that turn comes back to the
//    sender's own chat. A later reply to the request runs inside that thread.
// 3. A recipient at its task-list limit refuses the whole send: the other recipient keeps no empty
//    thread and no message goes out.
// 4. A mailbox refusal for one recipient (the deleting-recipient race) keeps the thread whose
//    message the mailbox took, leaves none for the rest, and a later send for the refused
//    recipient works.
// 5. A provider-level retry with the same call id, serial and concurrent, produces one thread and
//    one message per recipient and reuses the delivered ones.
// Writes .openbot-build/teammate-new-thread-service-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/teammate-new-thread-service-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-teammate-thread-service-"));
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

const CALL_MARK = "TEAMMATE-NEW-THREAD-CALL";
const run = crypto.randomUUID().slice(0, 6);
const PERSON = { id: "local", name: "Alex" };

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
/** Turn id -> the tool-call requests that wait for their results. */
const pending = new Map();
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
const issue = (threadId, turnId, id, request, mode) => {
  waiting.set(id, { threadId, turnId, callId: request.callId, request, mode: mode || null });
  write({ id, method: "item/tool/call", params: request });
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
      // The packet carries the request as JSON text, so its quotes arrive escaped.
      const { __tool, __mode, ...args } = JSON.parse(match[1].replace(/\\\\"/g, '"'));
      const request = {
        threadId: params.threadId,
        turnId,
        callId: "call-" + turnId,
        namespace: "openbot",
        tool: "tool_call",
        arguments: { name: "openbot." + __tool, arguments: args },
      };
      if (__mode === "twice") {
        pending.set(turnId, 2);
        issue(params.threadId, turnId, "tool-" + turnId + "-a", request, null);
        issue(params.threadId, turnId, "tool-" + turnId + "-b", request, null);
        return;
      }
      pending.set(turnId, 1);
      issue(params.threadId, turnId, "tool-" + turnId, request, __mode === "resend" ? "resend" : null);
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
      else if (!message.method && waiting.has(message.id)) {
        const held = waiting.get(message.id);
        waiting.delete(message.id);
        log({ callId: held.callId, turnId: held.turnId, result: message.result ?? null, error: message.error ?? null });
        if (held.mode === "resend") {
          // A same-call-id resend: the provider got the result, and sends its request once more. The
          // retry result takes the same pending slot, so the turn finishes after it.
          issue(held.threadId, held.turnId, "tool-" + held.turnId + "-retry", held.request, null);
          continue;
        }
        const left = (pending.get(held.turnId) ?? 1) - 1;
        pending.set(held.turnId, left);
        if (left <= 0) {
          pending.delete(held.turnId);
          finish(held.threadId, held.turnId);
        }
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** The tool-call modes that the fake runs. */
type CallMode = undefined | "resend" | "twice";

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
  callId: string;
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

const report: {
  steps: { name: string; details?: Record<string, string | number | boolean> }[];
  pageErrors: string[];
  passed: boolean;
  error?: string;
} = { steps: [], pageErrors: [], passed: false };
const step = (name: string, details: Record<string, string | number | boolean> = {}): void => {
  report.steps.push({ name, details });
  process.stdout.write(`${name}: passed\n`);
};

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

const toolLogs = (): ToolLog[] => {
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
};

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Waits until the agent's chat has no open delivery. */
function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

/** Waits until no side thread of the agent has a turn that runs or waits to start. */
function threadsIdle(agentId: string) {
  return waitFor("the side thread turns to end", () =>
    agents.listTasks(agentId).tasks.every((task) => task.state !== "running" && task.state !== "queued"),
  );
}

/** The arguments that one fake tool call passes, as the send_message schema reads them. */
interface SendToolArgs {
  recipientAgentIds: string[];
  text: string;
  newThread?: boolean;
  replyToMessageId?: string;
}

const callText = (tool: string, mode: CallMode, args: SendToolArgs) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, __mode: mode, ...args })}ARGS>>`;

/** Sends a message to the agent's own chat that makes the fake issue the tool call, and waits for the results. */
async function callFromChat(
  name: string,
  agentId: string,
  tool: string,
  mode: CallMode,
  args: SendToolArgs,
  results: number,
): Promise<ToolLog[]> {
  const before = toolLogs().length;
  await runCauseEffect(agents.sendMessage({ agentId, text: callText(tool, mode, args) }, PERSON));
  const logged = await waitFor(`${name} tool results`, () => {
    const entries = toolLogs().slice(before);
    return entries.length >= results ? entries : null;
  });
  await idle(agentId);
  return logged;
}

/** The threads that a tool result names, read with runtime checks. */
function resultThreads(
  entry: ToolLog,
): Array<{ recipientAgentId: string; taskId: string; messageId: string; deliveryId: string }> {
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  const parsed = JSON.parse(text);
  if (!isDynamicRecord(parsed) || !Array.isArray(parsed.threads))
    throw new Error(`The result names no threads: ${text}`);
  return parsed.threads.map((row) => {
    if (
      !isDynamicRecord(row) ||
      !isString(row.recipientAgentId) ||
      !isString(row.taskId) ||
      !isString(row.messageId) ||
      !isString(row.deliveryId)
    )
      throw new Error("The result names no thread identity.");
    return {
      recipientAgentId: row.recipientAgentId,
      taskId: row.taskId,
      messageId: row.messageId,
      deliveryId: row.deliveryId,
    };
  });
}

const failureText = (entry: ToolLog): string =>
  entry.result?.success === false ? entry.result.contentItems.map((item) => item.text).join("\n") : "";

/** The one tool result that the send logged, or a failure that names the wait. */
const firstEntry = (entries: ToolLog[], label: string): ToolLog => {
  const entry = entries[0];
  if (!entry) throw new Error(`${label} logged no tool result.`);
  return entry;
};

try {
  await runCauseEffect(agents.initialize());
  const alpha = await runCauseEffect(
    agents.createAgent({
      name: "Alpha",
      description: "Alpha sends the work.",
      avatarSeed: "alpha",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  const bravo = await runCauseEffect(
    agents.createAgent({
      name: "Bravo",
      description: "Bravo takes the work.",
      avatarSeed: "bravo",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(alpha.id);
  await idle(bravo.id);

  // 1. A plain turn answers.
  await runCauseEffect(agents.sendMessage({ agentId: alpha.id, text: `Plain hello ${run}` }, PERSON));
  await idle(alpha.id);
  const plainChat = await runCauseEffect(agents.readConversation(alpha.id));
  assert.equal(
    plainChat.messages.some((message) => message.text.includes("Done.")),
    true,
    "a plain turn answers",
  );
  step("1-plain-turn", {});

  // 2. The new-thread send through the real router, the drain's task lane, and the automatic result.
  const firstResults = await callFromChat(
    "new-thread send",
    alpha.id,
    "send_message",
    undefined,
    {
      recipientAgentIds: [bravo.id],
      text: `Route the report ${run}`,
      newThread: true,
    },
    1,
  );
  const first = resultThreads(firstEntry(firstResults, "new-thread send"));
  assert.equal(firstResults[0]?.result?.success, true, "the send succeeded");
  assert.equal(first.length, 1, "one thread for one recipient");
  assert.equal(first[0]?.recipientAgentId, bravo.id, "the thread belongs to the recipient");
  const bravoTaskId = first[0]?.taskId ?? "";
  const listed = agents.listTasks(bravo.id).tasks;
  assert.equal(
    listed.some((task) => task.id === bravoTaskId),
    true,
    "the task list names the thread",
  );
  await waitFor("the request in the thread", () =>
    agents.readTask(bravo.id, bravoTaskId).messages.some((message) => message.text.includes(`Route the report ${run}`)),
  );
  assert.equal(
    (await runCauseEffect(agents.readConversation(bravo.id))).messages.some((message) =>
      message.text.includes(`Route the report ${run}`),
    ),
    false,
    "the recipient's own chat hides the request",
  );
  await threadsIdle(bravo.id);
  const alphaChatAfterRelay = await runCauseEffect(agents.readConversation(alpha.id));
  assert.equal(
    alphaChatAfterRelay.messages.some((message) => message.text.includes("Done.")),
    true,
    "the automatic result of the thread's turn came back to the sender's chat",
  );
  const threadChat = agents.readTask(bravo.id, bravoTaskId);
  assert.equal(
    threadChat.messages.some((message) => message.text.includes("Done.")),
    true,
    "the thread keeps its own answer",
  );
  step("2-new-thread-turn-and-relay", { taskId: bravoTaskId });

  // A reply to the request continues the thread through the real router.
  const followUp = await callFromChat(
    "follow-up",
    alpha.id,
    "send_message",
    undefined,
    {
      recipientAgentIds: [bravo.id],
      text: `Follow-up note ${run}`,
      replyToMessageId: first[0]?.messageId,
    },
    1,
  );
  assert.equal(followUp[0]?.result?.success, true, "the follow-up send succeeded");
  await threadsIdle(bravo.id);
  await waitFor("the reply in the thread", () =>
    agents.readTask(bravo.id, bravoTaskId).messages.some((message) => message.text.includes(`Follow-up note ${run}`)),
  );
  assert.equal(
    (await runCauseEffect(agents.readConversation(bravo.id))).messages.some((message) =>
      message.text.includes(`Follow-up note ${run}`),
    ),
    false,
    "the reply does not reach the recipient's own chat",
  );
  step("2b-reply-continues-thread", {});

  // 3. A recipient at its task-list limit refuses the whole send.
  const charlie = await runCauseEffect(
    agents.createAgent({
      name: "Charlie",
      description: "Charlie has a full list.",
      avatarSeed: "charlie",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(charlie.id);
  for (let index = 0; index < 50; index += 1)
    await runCauseEffect(agents.startTask({ agentId: charlie.id, text: `Seed ${run} ${index}` }, PERSON));
  await threadsIdle(charlie.id);
  assert.equal(agents.listTasks(charlie.id).tasks.length, 50, "the person's tasks fill the list");
  const bravoTasksBefore = agents.listTasks(bravo.id).tasks.length;
  const refused = await callFromChat(
    "refused send",
    alpha.id,
    "send_message",
    undefined,
    {
      recipientAgentIds: [bravo.id, charlie.id],
      text: `Refused route ${run}`,
      newThread: true,
    },
    1,
  );
  assert.equal(refused[0]?.result?.success, false, "the send failed");
  assert.match(
    failureText(firstEntry(refused, "refused send")),
    /50 open threads/,
    "the refusal names the task-list limit",
  );
  assert.equal(agents.listTasks(bravo.id).tasks.length, bravoTasksBefore, "the other recipient keeps no empty thread");
  assert.equal(agents.listTasks(charlie.id).tasks.length, 50, "the refused recipient gains no thread");
  const refusedQueue = agents
    .listQueue(bravo.id)
    .deliveries.filter((delivery) => ["queued", "starting", "running"].includes(delivery.status))
    .map((delivery) => ({ status: delivery.status, text: delivery.text.slice(0, 60) }));
  assert.deepEqual(refusedQueue, [], "no message went out for the refused send");
  step("3-limit-refusal-sends-nothing", {});

  // 4. A mailbox refusal keeps the delivered thread and removes the rest; the retry works after.
  const delta = await runCauseEffect(
    agents.createAgent({
      name: "Delta",
      description: "Delta takes work.",
      avatarSeed: "delta",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  const echo = await runCauseEffect(
    agents.createAgent({
      name: "Echo",
      description: "Echo is deleted mid-call.",
      avatarSeed: "echo",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  const foxtrot = await runCauseEffect(
    agents.createAgent({
      name: "Foxtrot",
      description: "Foxtrot takes work.",
      avatarSeed: "foxtrot",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(delta.id);
  await idle(echo.id);
  await idle(foxtrot.id);
  const unblockEcho = mailbox.blockAgentDeliveries(echo.id);
  const raced = await callFromChat(
    "raced send",
    alpha.id,
    "send_message",
    undefined,
    {
      recipientAgentIds: [delta.id, echo.id, foxtrot.id],
      text: `Raced route ${run}`,
      newThread: true,
    },
    1,
  );
  unblockEcho();
  assert.equal(raced[0]?.result?.success, false, "the send failed on the deleting recipient");
  assert.match(
    failureText(firstEntry(raced, "raced send")),
    /being deleted/,
    "the refusal names the deleting recipient",
  );
  const deltaTasks = agents.listTasks(delta.id).tasks;
  assert.equal(deltaTasks.length, 1, "the delivered thread stays");
  await waitFor("the delivered thread's message", () =>
    agents
      .readTask(delta.id, deltaTasks[0]?.id ?? "")
      .messages.some((message) => message.text.includes(`Raced route ${run}`)),
  );
  assert.equal(agents.listTasks(echo.id).tasks.length, 0, "the deleting recipient keeps no thread");
  assert.equal(agents.listTasks(foxtrot.id).tasks.length, 0, "the undelivered recipient keeps no thread");
  const retryDelta = await callFromChat(
    "delta retry",
    alpha.id,
    "send_message",
    undefined,
    {
      recipientAgentIds: [delta.id],
      text: `Delta retry ${run}`,
      newThread: true,
    },
    1,
  );
  assert.equal(retryDelta[0]?.result?.success, true, "a later send for a fine recipient works");
  step("4-mailbox-refusal-keeps-delivered", {});

  // 5. A same-call-id retry, serial and concurrent, starts one thread and one message.
  const hotel = await runCauseEffect(
    agents.createAgent({
      name: "Hotel",
      description: "Hotel takes the retried work.",
      avatarSeed: "hotel",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(hotel.id);
  const serial = await callFromChat(
    "serial retry",
    alpha.id,
    "send_message",
    "resend",
    {
      recipientAgentIds: [hotel.id],
      text: `Serial retry ${run}`,
      newThread: true,
    },
    2,
  );
  assert.equal(serial.length, 2, "the provider resent the call once");
  const serialThreads = serial.map((entry) => resultThreads(firstEntry([entry], "serial retry")));
  assert.equal(serialThreads[0]?.[0]?.taskId, serialThreads[1]?.[0]?.taskId, "the retry reuses the same thread");
  assert.equal(serialThreads[0]?.[0]?.messageId, serialThreads[1]?.[0]?.messageId, "the retry reuses the same message");
  assert.equal(agents.listTasks(hotel.id).tasks.length, 1, "one thread for the retried send");
  step("5a-serial-retry", { taskId: serialThreads[0]?.[0]?.taskId ?? "" });

  const india = await runCauseEffect(
    agents.createAgent({
      name: "India",
      description: "India takes the concurrent retry.",
      avatarSeed: "india",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(india.id);
  const concurrent = await callFromChat(
    "concurrent retry",
    alpha.id,
    "send_message",
    "twice",
    {
      recipientAgentIds: [india.id],
      text: `Concurrent retry ${run}`,
      newThread: true,
    },
    2,
  );
  assert.equal(concurrent.length, 2, "both calls of the same call id got a result");
  const concurrentThreads = concurrent.map((entry) => resultThreads(firstEntry([entry], "concurrent retry")));
  assert.equal(
    concurrentThreads[0]?.[0]?.taskId,
    concurrentThreads[1]?.[0]?.taskId,
    "the concurrent retry reuses the thread",
  );
  assert.equal(
    concurrentThreads[0]?.[0]?.messageId,
    concurrentThreads[1]?.[0]?.messageId,
    "the concurrent retry reuses the message",
  );
  assert.equal(agents.listTasks(india.id).tasks.length, 1, "one thread for the concurrent retry");
  step("5b-concurrent-retry", { taskId: concurrentThreads[0]?.[0]?.taskId ?? "" });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  report.pageErrors.push(`codex log: ${readFileSync(fakeLog, "utf8").slice(0, 4000)}`);
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
