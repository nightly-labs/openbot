// Checks issue #12353: a ChatGPT app (Codex `codex_apps`) that refuses to run because Codex has full
// access and its automatic approval review is off gets one plain OpenBot notice for the chat, for an
// agent with Ask first or Full access. A Workspace only agent, another failure of the app, and the same
// text from another MCP server keep the old behavior. OpenBot still sends `approvalsReviewer: "user"`.
// Runs the real agent service on a temporary profile with a fake Codex app-server. A turn whose input
// has `APP-CASE <name>` completes one `mcpToolCall` item of that case, then answers.
// `bun scripts/codex-app-auto-review-e2e.ts`. Writes .openbot-build/codex-app-auto-review-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-app-auto-review-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-app-auto-review-"));
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
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { LibraryFoldersStore } = await import("../src/backend/library-folders-store");

const CASE_MARK = "APP-CASE";
const NOTICE_CODE = "mcp_app_auto_review";
/** The text of issue #12353, as the app sends it. */
const REFUSAL =
  'Finances and Health tools are unavailable in Full Access mode while automatic approval review is disabled. Switch to "Approve for me" mode, then retry.';

/**
 * A Codex app-server with the methods that the service calls. It logs the params of each
 * `thread/start`, `thread/resume` and `turn/start`. A turn with `APP-CASE <name>` first completes the
 * `mcpToolCall` item of that case.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const REFUSAL = ${JSON.stringify(REFUSAL)};
const CASES = {
  "refusal-result": { server: "codex_apps", status: "failed", result: { content: [{ type: "text", text: REFUSAL }] } },
  "refusal-error": { server: "codex_apps", status: "failed", error: { message: REFUSAL } },
  "other-failure": { server: "codex_apps", status: "failed", result: { content: [{ type: "text", text: "The account is not connected." }] } },
  "other-server": { server: "finances", status: "failed", result: { content: [{ type: "text", text: REFUSAL }] } },
};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
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
  if (["thread/start", "thread/resume", "turn/start"].includes(message.method))
    log({ method: message.method, approvalsReviewer: params.approvalsReviewer ?? null, sandbox: params.sandbox ?? params.sandboxPolicy ?? null });
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
      const name = new RegExp(${JSON.stringify(CASE_MARK)} + " ([a-z-]+)").exec(text)?.[1];
      const found = name ? CASES[name] : undefined;
      if (found) {
        const item = { type: "mcpToolCall", id: "app-" + turnId, tool: "get_accounts", arguments: {}, ...found };
        write({ method: "item/started", params: { threadId: params.threadId, turnId, item: { ...item, status: "inProgress" } } });
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      }
      return setTimeout(() => finish(params.threadId, turnId), 20);
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

interface RequestLog {
  method: string;
  approvalsReviewer: string | null;
  sandbox: unknown;
}

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

function requestLogs(): RequestLog[] {
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

const report: {
  cases: { name: string; access: string; notices: { code: string; message: string }[] }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { cases: [], checks: [], passed: false };

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const library = new LibraryFoldersStore(join(userData, "library-folders.json"));
const agents = new AgentService({
  store,
  mailbox,
  browser,
  sidebarLayout: sidebar,
  libraryFolders: {
    getSnapshot: () => library.getSnapshot(),
    placeInPath: (agentId, names, fileIds, context) => library.placeInPath(agentId, names, fileIds, context),
    mutate: (action, context) => library.mutate(action, context),
    removeAgent: (agentId) => library.removeAgent(agentId),
    fileAgents: () => Effect.succeed(new Map<string, string | null>()),
  },
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
  // Ask first: the agent reaches the whole computer and asks, as the reporter's agent did.
  approvalAutomation: {
    autoApproves: () => false,
    set: () => Effect.succeed({ defaultAutoApprove: false, autoApproveOverrides: {} }),
  },
});

/** The error events that the service sends, in order. */
const errors: { code: string; message: string; agentId?: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error")
    errors.push({ code: event.code, message: event.message, ...(event.agentId ? { agentId: event.agentId } : {}) });
});

/** Waits until the agent's chat has no open delivery. */
function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

/** Runs one turn of a case and returns the notices of this issue that it sent. */
async function runCase(name: string, agentId: string, access: string) {
  const before = errors.length;
  const turnsBefore = requestLogs().filter((entry) => entry.method === "turn/start").length;
  await runCauseEffect(agents.sendMessage({ agentId, text: `${CASE_MARK} ${name}` }, { id: "local", name: "Alex" }));
  await waitFor(
    `the turn of ${name}`,
    () => requestLogs().filter((entry) => entry.method === "turn/start").length > turnsBefore,
  );
  await idle(agentId);
  const notices = errors
    .slice(before)
    .filter((entry) => entry.code === NOTICE_CODE)
    .map(({ code, message }) => ({ code, message }));
  report.cases.push({ name, access, notices });
  return notices;
}

const NOTICE = sourceText("error.backend.mcpAppAutoReview");

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(library.initialize());
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Planner",
      description: "Planner keeps the budget.",
      avatarSeed: "planner",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(agent.id);

  // 1. The refusal of the issue, with full access: one notice in the user's terms.
  const fromResult = await runCase("refusal-result", agent.id, "full");
  pass(
    "The refusal in the tool result gives one notice with the OpenBot text",
    fromResult.length === 1 && fromResult[0]?.message === NOTICE,
    JSON.stringify(fromResult),
  );
  const fromError = await runCase("refusal-error", agent.id, "full");
  pass(
    "The refusal in the item error gives the same notice",
    fromError.length === 1 && fromError[0]?.message === NOTICE,
    JSON.stringify(fromError),
  );

  // 2. Other failures keep the old behavior.
  const other = await runCase("other-failure", agent.id, "full");
  pass("Another failure of a ChatGPT app gives no notice", other.length === 0, JSON.stringify(other));
  const ownServer = await runCase("other-server", agent.id, "full");
  pass("The same text from another MCP server gives no notice", ownServer.length === 0, JSON.stringify(ownServer));

  // 3. The approval settings that OpenBot sends do not change (#7800).
  const requests = requestLogs();
  pass(
    "Each thread and turn request still sends approvalsReviewer user",
    requests.length > 0 && requests.every((entry) => entry.approvalsReviewer === "user"),
    JSON.stringify(requests),
  );

  // 4. A Workspace only agent does not have full access, so the app's text does not apply to it.
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, access: "workspace" }));
  const workspace = await runCase("refusal-result", agent.id, "workspace");
  const lastTurn = requestLogs()
    .filter((entry) => entry.method === "turn/start")
    .at(-1);
  pass(
    "The Workspace only turn sends no full access",
    lastTurn !== undefined && !JSON.stringify(lastTurn.sandbox).toLowerCase().includes("fullaccess"),
    JSON.stringify(lastTurn),
  );
  pass("A Workspace only agent gets no notice", workspace.length === 0, JSON.stringify(workspace));

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
