// Checks that each routine of an agent that is set to run in a separate thread runs in its own side
// thread, and that each run starts its own provider session, so that it does not send the whole chat context again. Runs the real agent
// service on a temporary profile with a fake Codex app-server. The fake keeps the context of each
// session: each request sends all of the session's earlier input again, as a model request does, and
// reports that size as input tokens. The chat gets about 45,000 tokens of history, then a routine
// runs twice. The check asserts that each run starts an ephemeral session and closes it, that its
// request stays small, that both runs use one routine thread and their answers show there and not in
// the chat, that the chat keeps its session, and that the chat turns read the answers. While the
// second run is held, a chat message and a run of a second routine must finish: the lanes do not wait
// for each other. The second routine opens a wait, which a routine thread can do as the chat can.
// A routine with no run place runs in the chat: its answer shows in the chat, and it gets no thread.
// It also drives saved password and authenticator fills through the routine tool router, checks
// the sign-in guidance, and checks that no secret reaches the provider. Each run keeps the agent's
// Computer Use, as the chat does: a scheduled run can drive a desktop app.
// `bun scripts/routine-fresh-session-e2e.ts`. Writes .openbot-build/routine-fresh-session-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type BrowserTab,
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  decodeUsageTokens,
  parseRoutineRunConversationEventItemType,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-fresh-session-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-session-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
/** While this file exists, the fake holds each turn of the first routine before its answer. */
const fakeHold = join(root, "hold");

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

/** Tokens that each session holds before its first request: the instructions and the tools. */
const BASE_TOKENS = 3_000;
/** Each history message, in characters. Four of them make about 45,000 tokens. */
const HISTORY_CHARACTERS = 45_000;
const ROUTINE_INPUT_LIMIT = 10_000;
const ROUTINE_MARK = "ROUTINE-CHECK";
const SECOND_MARK = "ROUTINE-SECOND";
const VAULT_ORIGIN = "https://routine.openbot.test";
const VAULT_LOGIN = "routine-login";
const PASSWORD = "fixture-routine-password";
const CODE = "739182";

/**
 * A Codex app-server with the methods that the service calls. It writes each `thread/start`,
 * `thread/resume`, `thread/unsubscribe` and `turn/start` to the log. A routine turn answers with a
 * numbered report; other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const HOLD = ${JSON.stringify(fakeHold)};
const BASE = ${BASE_TOKENS};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
let reports = 0;
const waiting = new Map();
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return turn.finish();
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, { turn, tool: call.arguments.name ?? call.tool });
  write({ id, method: "item/tool/call", params: {
    threadId: turn.threadId, turnId: turn.turnId, callId: id,
    namespace: "openbot", tool: call.tool, arguments: call.arguments,
  } });
};
/** threadId -> characters of all input so far, and the prompt and totals of the last request. */
const context = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const breakdown = (input, cached, output) => ({ totalTokens: input + output, inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 });
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
    case "thread/start": {
      const id = "thread-" + (++threads);
      log({ method: "thread/start", threadId: id, ephemeral: params.ephemeral ?? null, persistSession: params.persistSession ?? null, instructions: params.developerInstructions, mcpServers: Object.entries((params.config && params.config.mcp_servers) || {}).filter(([, server]) => server.enabled !== false).map(([name]) => name) });
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume":
      log({ method: "thread/resume", threadId: params.threadId });
      return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe":
      log({ method: "thread/unsubscribe", threadId: params.threadId });
      return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      const state = context.get(params.threadId) ?? { characters: 0, prompt: 0, input: 0, cached: 0, output: 0 };
      state.characters += text.length;
      const prompt = BASE + Math.ceil(state.characters / 4);
      const cached = Math.min(state.prompt, prompt);
      Object.assign(state, { prompt, input: state.input + prompt, cached: state.cached + cached, output: state.output + 100 });
      context.set(params.threadId, state);
      log({ method: "turn/start", threadId: params.threadId, turnId, characters: text.length, prompt, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const tokenUsage = { total: breakdown(state.input, state.cached, state.output), last: breakdown(prompt, cached, 100), modelContextWindow: 1000000 };
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage } });
      const second = text.includes(${JSON.stringify(SECOND_MARK)});
      const routine = !second && text.includes(${JSON.stringify(ROUTINE_MARK)});
      const reply = second ? "Second routine report: the docs are current." : routine ? "Routine report " + (++reports) + ": the build is green." : "Done.";
      const answerTurn = () => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: reply, phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      };
      const browserCall = (tool, args) => ({ tool: "tool_call", arguments: { name: "openbot_browser." + tool, arguments: args } });
      const secret = (method) => browserCall("submit_secret", {
        tabId: "routine-tab", loginId: ${JSON.stringify(VAULT_LOGIN)}, method, digits: 6,
        targets: [{ kind: "css", selector: "#secret" }], submission: "click",
        submitTarget: { kind: "css", selector: "#submit" },
      });
      let held = false;
      const finish = () => {
        if (!routine || !existsSync(HOLD)) return answerTurn();
        if (!held) log({ method: "turn/held", threadId: params.threadId, turnId });
        held = true;
        setTimeout(finish, 20);
      };
      const calls = routine ? [
        { tool: "tool_describe", arguments: { names: ["openbot_browser.list_logins"] } },
        browserCall("open", { url: ${JSON.stringify(VAULT_ORIGIN)} }),
        browserCall("list_logins", { tabId: "routine-tab" }),
        secret("password"), secret("authenticator"),
      ] : second ? [
        // A routine thread keeps the tools of the agent's own chat, as a routine run in the chat had.
        { tool: "await_event", arguments: { note: "Report when the docs change." } },
      ] : [];
      callNext({ threadId: params.threadId, turnId, calls, finish });
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
        const { turn, tool } = waiting.get(message.id);
        waiting.delete(message.id);
        log({ method: "tool-result", threadId: turn.threadId, turnId: turn.turnId, tool, result: message.result, error: message.error });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface LogEntry {
  method: string;
  threadId: string;
  turnId?: string;
  ephemeral?: boolean | null;
  persistSession?: boolean | null;
  characters?: number;
  prompt?: number;
  text?: string;
  instructions?: string;
  mcpServers?: string[];
  tool?: string;
  result?: { success: boolean; contentItems: { type: string; text?: string }[] };
  error?: { message: string };
}

interface TurnReport {
  name: string;
  threadId: string;
  turnId: string;
  inputCharacters: number;
  recordedInputTokens: number;
  sessionId: string;
}

const report: {
  mainSession?: { before: string; after: string };
  threadStarts: Omit<LogEntry, "text">[];
  closedThreads: string[];
  turns: TurnReport[];
  routineAnswersInChat: string[];
  routineThreads: { routine: string; taskId: string; threadId: string; title: string; answers: string[] }[];
  whileHeld?: { chatTurn: string; secondRoutineRun: string; heldRunStatus: string };
  runStatuses?: string[];
  runMarkersInChat?: string[];
  waitInRoutineThread?: unknown[];
  digestInNextTurn?: { marker: boolean; answers: string[] };
  chatRoutine?: { threads: number; answersInChat: number; runStatus: string };
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = {
  threadStarts: [],
  closedThreads: [],
  turns: [],
  routineAnswersInChat: [],
  routineThreads: [],
  checks: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
let tab: BrowserTab | undefined;
const fills: string[] = [];
let takeoverRequests = 0;
const browser: AgentBrowserHost = {
  listTabs: () => (tab ? [tab] : []),
  prepareSecret: (params) =>
    Effect.sync(() => {
      assert.equal(params.ownerAgentId, tab?.ownerAgentId);
      assert.equal(params.threadId, tab?.ownerThreadId);
      const method = getString(getRecord(params, "arguments"), "method");
      assert.ok(method === "password" || method === "authenticator");
      return {
        request: { method, origin: VAULT_ORIGIN, digits: 6 },
        agentScriptedOrigin: false,
        vaultFillable: true,
        submit: (value) =>
          Effect.sync(() => {
            assert.equal(value, method === "password" ? PASSWORD : CODE);
            fills.push(method);
            return "submitted" as const;
          }),
        cancel: () => {},
      };
    }),
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: (params) =>
    Effect.sync(() => {
      assert.equal(params.tool, "open");
      tab = {
        id: "routine-tab",
        title: "Sign in",
        url: VAULT_ORIGIN,
        loading: false,
        ownerThreadId: params.threadId,
        ownerAgentId: params.ownerAgentId ?? null,
      };
      return { success: true, contentItems: [{ type: "inputText" as const, text: JSON.stringify(tab) }] };
    }),
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

/** Waits for a state of the service, its database or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

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
  passwordVault: {
    connected: () => true,
    loginsFor: (origin) => {
      assert.equal(origin, VAULT_ORIGIN);
      return Effect.succeed([
        { id: VAULT_LOGIN, title: "Routine", username: "routine@example.test", hasOneTimePassword: true },
      ]);
    },
    secretFor: (id, origin, kind) => {
      assert.equal(id, VAULT_LOGIN);
      assert.equal(origin, VAULT_ORIGIN);
      return Effect.succeed(kind === "password" ? PASSWORD : CODE);
    },
  },
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  // The driver is not started: only the entry that the provider is given is checked.
  computerUseMcpServer: () => ({
    id: COMPUTER_USE_MCP_SERVER_ID,
    name: COMPUTER_USE_MCP_SERVER_NAME,
    transport: "stdio",
    enabled: true,
    command: fakeCodex,
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  }),
});
agents.on("event", (event: AgentEvent) => {
  if (event.type === "browser-takeover-requested") takeoverRequests += 1;
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

/** The usage session and the input tokens that the records of one provider turn hold. */
function usageOf(turnId: string): { sessionId: string; input: number } | null {
  const rows = sqlite()
    .prepare("SELECT session_id, tokens_json FROM agent_usage_records WHERE turn_id = ?")
    .all(turnId)
    .map((row) => ({
      sessionId: String(row.session_id),
      tokens: decodeUsageTokens(JSON.parse(String(row.tokens_json))),
    }));
  const first = rows[0];
  if (!first) return null;
  const input = rows.reduce(
    (sum, row) =>
      sum + (row.tokens.uncachedInput ?? 0) + (row.tokens.cachedInput ?? 0) + (row.tokens.cacheCreation ?? 0),
    0,
  );
  return { sessionId: first.sessionId, input };
}

function mainSession(threadId: string): string[] {
  return sqlite()
    .prepare("SELECT external_session_id FROM projection_provider_sessions WHERE thread_id = ? AND state = 'active'")
    .all(threadId)
    .map((row) => String(row.external_session_id));
}

async function settled(deliveryId: string, label: string, timeoutMs?: number) {
  const status = await waitFor(
    label,
    () => {
      const value = mailbox.getDelivery(deliveryId)?.delivery.status;
      return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
    },
    timeoutMs,
  );
  assert.equal(status, "completed", `${label}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
}

async function send(agentId: string, text: string, label: string, timeoutMs?: number) {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${label}: no delivery`);
  await settled(deliveryId, label, timeoutMs);
}

/** The side thread of a routine, and the answers that its conversation shows. */
function routineThread(agentId: string, routineId: string, mark: string) {
  const tasks = agents.listTasks(agentId).tasks.filter((task) => task.routineId === routineId);
  assert.equal(tasks.length, 1, `routine ${routineId}: ${tasks.length} threads`);
  const [task] = tasks;
  assert.ok(task);
  const answers = agents
    .readTask(agentId, task.id)
    .messages.map((message) => message.text)
    .filter((text) => text.startsWith(mark));
  return { routine: routineId, taskId: task.id, threadId: task.threadId, title: task.title, answers };
}

function turnEntry(name: string, entry: LogEntry): TurnReport {
  assert.ok(entry.turnId);
  const usage = usageOf(entry.turnId);
  assert.ok(usage, `${name}: no usage records`);
  const result: TurnReport = {
    name,
    threadId: entry.threadId,
    turnId: entry.turnId,
    inputCharacters: entry.characters ?? 0,
    recordedInputTokens: usage.input,
    sessionId: usage.sessionId,
  };
  report.turns.push(result);
  return result;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Routines",
      description: "Checks routine sessions.",
      avatarSeed: "routines",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  const chatThread = await waitFor(
    "the agent's own thread",
    () => store.list().find((a) => a.id === agent.id)?.threadId,
  );
  await waitFor("the first chat turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
  for (let index = 1; index <= 4; index += 1) {
    const filler = `History message ${index}. ${"The quarterly numbers look stable this week. ".repeat(1_000)}`;
    await send(agent.id, filler.slice(0, HISTORY_CHARACTERS), `history message ${index}`);
  }
  const [mainBefore] = mainSession(chatThread);
  assert.ok(mainBefore, "The chat has an active provider session.");
  const lastChatTurn = fakeEntries()
    .filter((entry) => entry.method === "turn/start" && entry.threadId === mainBefore)
    .at(-1);
  assert.ok(lastChatTurn);
  const chatTurn = turnEntry("last history turn", lastChatTurn);
  pass("The chat session holds about 45,000 tokens", chatTurn.recordedInputTokens >= 45_000);

  const routine = agents.createRoutine({
    agentId: agent.id,
    name: "Build check",
    instruction: `${ROUTINE_MARK}: check the build and report.`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    runIn: "thread",
  });
  const secondRoutine = agents.createRoutine({
    agentId: agent.id,
    name: "Docs check",
    instruction: `${SECOND_MARK}: check the docs and report.`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "10:00" },
    runIn: "thread",
  });
  const buildTurns = () =>
    fakeEntries().filter(
      (item) => item.method === "turn/start" && item.text?.includes(ROUTINE_MARK) && !item.text.includes(SECOND_MARK),
    );
  const routineTurns: TurnReport[] = [];
  for (const run of [1, 2]) {
    // The second run waits before its answer, until the chat and the second routine have finished.
    if (run === 2) await writeFile(fakeHold, "");
    const queued = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
    assert.ok(queued.deliveryId, `routine run ${run}: no delivery`);
    const runDeliveryId = queued.deliveryId;
    if (run === 2) {
      await waitFor("the held routine run", () =>
        fakeEntries().some((item) => item.method === "turn/held" && item.turnId === buildTurns()[1]?.turnId),
      );
      await send(agent.id, "Are you there?", "chat turn while a routine runs", 10_000);
      const other = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: secondRoutine.id }));
      assert.ok(other.deliveryId, "second routine: no delivery");
      await settled(other.deliveryId, "second routine run while the first runs", 10_000);
      report.whileHeld = {
        chatTurn: "completed",
        secondRoutineRun: "completed",
        heldRunStatus: mailbox.getDelivery(runDeliveryId)?.delivery.status ?? "missing",
      };
      pass("The held routine run still runs", report.whileHeld.heldRunStatus === "running");
      await rm(fakeHold);
    }
    await settled(runDeliveryId, `routine run ${run}`);
    const entry = await waitFor(`routine run ${run} turn`, () => buildTurns().at(run - 1));
    await waitFor(`routine run ${run} session to close`, () =>
      fakeEntries().some((item) => item.method === "thread/unsubscribe" && item.threadId === entry.threadId),
    );
    routineTurns.push(turnEntry(`routine run ${run}`, entry));
  }
  const buildThread = routineThread(agent.id, routine.id, "Routine report");
  const docsThread = routineThread(agent.id, secondRoutine.id, "Second routine report");
  report.routineThreads = [buildThread, docsThread];

  const entries = fakeEntries();
  report.threadStarts = entries
    .filter((entry) => entry.method === "thread/start")
    .map(({ text: _text, ...rest }) => rest);
  report.closedThreads = entries
    .filter((entry) => entry.method === "thread/unsubscribe")
    .map((entry) => entry.threadId);
  const routineStarts = report.threadStarts.filter((entry) => entry.ephemeral === true);
  const toolResults = entries.filter((entry) => entry.method === "tool-result");
  const results = toolResults.filter((entry) => entry.tool !== "await_event");
  const waitResults = toolResults.filter((entry) => entry.tool === "await_event");
  report.waitInRoutineThread = waitResults.map((entry) => entry.result ?? entry.error ?? null);
  pass(
    "A run in a routine thread can open a wait",
    waitResults.length === 1 &&
      waitResults[0]?.result?.success === true &&
      waitResults[0].turnId ===
        entries.find((entry) => entry.method === "turn/start" && entry.text?.includes(SECOND_MARK))?.turnId,
  );
  pass(
    "Routine Vault tool calls succeed",
    results.length === 10 && results.every((entry) => entry.result?.success && !entry.error),
  );
  pass(
    "Each routine fills its saved password and authenticator code",
    fills.join() === "password,authenticator,password,authenticator",
  );
  const listed = results.filter((entry) => entry.tool === "openbot_browser.list_logins");
  pass(
    "Each routine can discover its saved login",
    listed.length === 2 &&
      listed.every((entry) => {
        const text = entry.result?.contentItems[0]?.text ?? "";
        return text.includes(VAULT_LOGIN) && text.includes("routine@example.test") && text.includes('"connected":true');
      }),
  );
  pass("Saved logins need no user takeover", takeoverRequests === 0);
  pass(
    "Routine browser tabs belong to the routine thread",
    tab?.ownerThreadId === buildThread.threadId && tab.ownerAgentId === agent.id,
  );
  pass(
    "Secrets stay outside provider input and tool results",
    [PASSWORD, CODE].every((value) => !JSON.stringify(entries).includes(value)),
  );
  const routineRule = "In a routine run, first check saved logins with openbot_browser.list_logins";
  pass(
    "Routine sessions receive the saved-login rule",
    routineStarts.every((entry) => entry.instructions?.includes(routineRule)),
  );
  pass(
    "Discovered browser guidance reports only a sign-in that needs the user",
    results
      .filter((entry) => entry.tool === "tool_describe")
      .every((entry) => JSON.stringify(entry.result).includes("report a sign-in that needs the user, not a takeover")),
  );
  pass(
    "Routine guidance reports steps that need a person",
    routineStarts.every((entry) =>
      entry.instructions?.includes("do not call request_takeover or submit_secret without loginId"),
    ),
  );
  pass("Each routine run starts one new session", routineStarts.length === 3);
  pass(
    "Each routine run gets Computer Use",
    routineStarts.every(
      (entry) =>
        entry.mcpServers?.includes(COMPUTER_USE_MCP_SERVER_NAME) &&
        entry.instructions?.includes(`Use ${COMPUTER_USE_MCP_SERVER_NAME} for every GUI task`),
    ),
  );
  pass(
    "Routine sessions are ephemeral and not saved",
    routineStarts.every((entry) => entry.persistSession === false),
  );
  pass(
    "Each routine turn runs in its own session",
    new Set(routineTurns.map((turn) => turn.threadId)).size === 2 &&
      routineTurns.every(
        (turn) => turn.threadId !== mainBefore && routineStarts.some((entry) => entry.threadId === turn.threadId),
      ),
  );
  pass(
    "Each routine session closes after its run",
    routineTurns.every((turn) => report.closedThreads.includes(turn.threadId)),
  );
  pass(
    "The first routine request stays small",
    routineTurns.every((turn) => turn.recordedInputTokens <= ROUTINE_INPUT_LIMIT),
    routineTurns.map((turn) => turn.recordedInputTokens).join(", "),
  );
  pass(
    "Routine usage belongs to the routine session",
    routineTurns.every((turn) => turn.sessionId === `routine:${turn.threadId}`),
  );
  pass(
    "The second run reads the first run's answer",
    entries.some(
      (entry) =>
        entry.method === "turn/start" &&
        entry.threadId === routineTurns[1]?.threadId &&
        entry.text?.includes("Routine report 1"),
    ),
  );
  const after = mainSession(chatThread);
  report.mainSession = { before: mainBefore, after: after.join(",") };
  pass("The chat keeps its one provider session", after.length === 1 && after[0] === mainBefore);

  const conversation = await runCauseEffect(agents.readConversation(agent.id));
  report.routineAnswersInChat = conversation.messages
    .map((message) => message.text)
    .filter((text) => text.startsWith("Routine report") || text.startsWith("Second routine report"));
  pass("No routine answer shows in the chat", report.routineAnswersInChat.length === 0);
  // A run in a routine thread still gets its status, its History row and its marker in the chat.
  const runStatuses = () =>
    [routine, secondRoutine].flatMap((item) =>
      agents.listRoutineRuns({ agentId: agent.id, routineId: item.id }).map((run) => run.status),
    );
  report.runStatuses = await waitFor("the routine runs to succeed", () => {
    const statuses = runStatuses();
    return statuses.length === 3 && statuses.every((status) => status === "succeeded") ? statuses : null;
  }).catch(() => runStatuses());
  pass(
    "Each routine run in a routine thread succeeds",
    report.runStatuses.every((status) => status === "succeeded"),
  );
  report.runMarkersInChat = (await runCauseEffect(agents.readConversation(agent.id))).messages.flatMap((message) => {
    const event = parseRoutineRunConversationEventItemType(message.itemType);
    return event ? [event.status] : [];
  });
  pass(
    "The chat shows each routine run as a marker",
    report.runMarkersInChat.filter((status) => status === "succeeded").length === 3,
  );
  pass(
    "Both runs of a routine answer in its one thread",
    buildThread.answers.length === 2 && buildThread.title === "Build check",
  );
  pass(
    "Each routine has its own thread",
    docsThread.answers.length === 1 &&
      docsThread.threadId !== buildThread.threadId &&
      docsThread.title === "Docs check",
  );
  const heldChatTurn = fakeEntries().find(
    (entry) => entry.method === "turn/start" && entry.threadId === mainBefore && entry.text?.includes("Are you there?"),
  );
  pass(
    "The chat turn during a routine run reads the earlier run",
    heldChatTurn?.text?.includes("Routine report 1") === true,
  );

  await send(agent.id, "What did the routine find?", "chat turn after the routines");
  const next = fakeEntries()
    .filter((entry) => entry.method === "turn/start" && entry.threadId === mainBefore)
    .at(-1);
  assert.ok(next?.text);
  const answers = ["Routine report 2", "Second routine report"].filter((answer) => next.text?.includes(answer));
  report.digestInNextTurn = { marker: next.text.includes("routine run in its own session"), answers };
  pass("The next chat turn reads the later routine answers", report.digestInNextTurn.marker && answers.length === 2);
  pass(
    "The chat did not resume or restart its session",
    !fakeEntries().some((entry) => entry.method === "thread/resume") &&
      report.threadStarts.filter((entry) => entry.ephemeral !== true).length === 1,
  );

  // A routine with no run place runs in the chat, as before 0.61.
  const chatRoutine = agents.createRoutine({
    agentId: agent.id,
    name: "Chat check",
    instruction: "Check the chat and report.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "11:00" },
  });
  const chatRun = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: chatRoutine.id }));
  assert.ok(chatRun.deliveryId, "chat routine: no delivery");
  const chatRunDeliveryId = chatRun.deliveryId;
  await settled(chatRunDeliveryId, "chat routine run");
  const chatRunStatus = await waitFor("the chat routine run to end", () => {
    const status = agents.listRoutineRuns({ agentId: agent.id, routineId: chatRoutine.id })[0]?.status;
    return status && status !== "running" && status !== "queued" ? status : null;
  });
  const chatRunTurnId = mailbox.getDelivery(chatRunDeliveryId)?.delivery.turnId;
  report.chatRoutine = {
    threads: agents.listTasks(agent.id).tasks.filter((task) => task.routineId === chatRoutine.id).length,
    answersInChat: (await runCauseEffect(agents.readConversation(agent.id))).messages.filter(
      (message) =>
        chatRunTurnId !== undefined && message.turnId === chatRunTurnId && message.itemType === "final_answer",
    ).length,
    runStatus: chatRunStatus,
  };
  pass(
    "A routine with no run place answers in the chat and gets no thread",
    report.chatRoutine.threads === 0 && report.chatRoutine.answersInChat === 1 && chatRunStatus === "succeeded",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  closeReader();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
