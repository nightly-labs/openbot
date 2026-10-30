// Checks that OpenBot keeps a provider session when nothing in it is out of date, so the provider
// keeps its history and its prompt cache. Runs the real agent service on a temporary profile with
// stand-in provider executables. Cases:
// - claude-refresh-resumes: a runtime refresh (an MCP or skill change) closes the Claude process and
//   the next turn resumes the same session, with no history handoff. Before, it started a new session.
// - codex-approval-grant-keeps-session: a tool approval granted in `~/.codex/config.toml` keeps the
//   Codex session. A revoked approval still replaces it. Before, a grant also replaced it.
// - antigravity-channel-delta: a channel member on Antigravity gets only the unread channel messages
//   in its next turn on the same session. Before, each turn got the complete channel packet.
// `bun scripts/provider-session-reuse-e2e.ts`. Writes .openbot-build/provider-session-reuse-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  defaultProviderModel,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentClientFactory } from "../src/backend/agent/provider-runtime";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-session-reuse-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-session-reuse-"));
const home = join(root, "home");
const claudeExecutable = join(root, "claude");
const claudeSpawns = join(root, "claude-spawns.jsonl");
const claudeMessages = join(root, "claude-messages.jsonl");
const fakeCodex = join(root, "codex");
const codexLog = join(root, "codex.jsonl");
const codexConfig = join(root, "codex-mcp-servers.json");
const mcpScript = join(root, "echo-mcp.js");
const agyInstall = join(root, "antigravity");
const fakeAgy = join(agyInstall, "bin", "agy_acp_server");
const agyLog = join(root, "agy.jsonl");
const CLAUDE_MODEL = defaultProviderModel("claude");

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { CODEX_PLACEHOLDER_COMMAND, codexMcpServerKey } = await import("../src/backend/mcp-provider-shapes");
const { CURRENT_MESSAGE_SEPARATOR, HANDOFF_START } = await import("../src/backend/agent/delivery-content");

/**
 * The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end. It
 * logs each start with its `--resume` session, and the text of each user message it gets.
 */
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const resume = option("--resume");
const sessionId = resume ?? option("--session-id") ?? randomUUID();
fs.appendFileSync(${JSON.stringify(claudeSpawns)}, JSON.stringify({ pid: process.pid, resume, sessionId }) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let requests = 0;
const turn = (message) => {
  const content = message.message?.content;
  const text = typeof content === "string" ? content : (content ?? []).map((block) => block.text ?? "").join("");
  fs.appendFileSync(${JSON.stringify(claudeMessages)}, JSON.stringify({ pid: process.pid, sessionId, text }) + "\\n");
  const id = "msg_" + process.pid + "_" + (++requests);
  const usage = { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 20 };
  write({ type: "assistant", message: { id, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text: "Done." }], stop_reason: null, usage }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  write({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0.01, usage, permission_denials: [] });
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request")
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

/**
 * A Codex app-server with the methods that the service calls. It logs each request. `config/read`
 * returns the `mcp_servers` table of a JSON file that the check changes, as Codex returns the table
 * of `~/.codex/config.toml`.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(${JSON.stringify(codexLog)}, JSON.stringify(entry) + "\\n");
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
  log({ method: message.method, threadId: params.threadId ?? null });
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": {
      const servers = JSON.parse(fs.readFileSync(${JSON.stringify(codexConfig)}, "utf8"));
      return write({ id: message.id, result: { config: { mcp_servers: servers }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: servers } }] } });
    }
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
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

/** An Antigravity ACP server with the methods that the service calls. It logs each prompt. */
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(${JSON.stringify(agyLog)}, JSON.stringify({ pid: process.pid, ...entry }) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "gemini-3-pro";
const setup = (sessionId) => ({ sessionId, models: { availableModels: [{ modelId: MODEL, name: "Gemini 3 Pro" }], currentModelId: MODEL } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("agy-" + process.pid + "-" + ++sessions) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    log({ sessionId: params.sessionId, length: text.length, text });
    // The context fill: a drop is a compaction that the agent does by itself, and a nearly full
    // context makes OpenBot replace the session.
    const used = text.includes("usage-high") ? 900000 : text.includes("usage-drop") ? 1000 : 400000;
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "usage_update", used, size: 1000000 } } });
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } } });
    return write({ id: message.id, result: { stopReason: "end_turn" } });
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. Sessions, turns and events come from the real client.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  canReleaseProcess = () => this.#real.canReleaseProcess();

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: CLAUDE_MODEL, displayName: "Claude" }] }));
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    this.#real.respondError(id, error);
  }
}

interface PromptReport {
  sessionId: string;
  length: number;
}

/** What each case saw. Each case sets only its own fields. */
interface CaseDetails {
  sessionRows?: { session: string; state: string }[];
  spawns?: { resume: string | null; sessionId: string }[];
  secondTurnHasHandoff?: boolean | null;
  serverKey?: string;
  threadStarts?: { afterTurn1: number; afterGrantTurn2: number; afterRevokeTurn3: number; afterPromptTurn4: number };
  prompts?: PromptReport[];
  firstPrompt?: PromptReport;
  secondPrompt?: PromptReport & { repeatsFirstRequest: boolean };
  afterCompaction?: { sessionId: string; repeatsFirstRequest: boolean };
  afterRotation?: { sessionId: string; repeatsFirstRequest: boolean };
  channelPromptCount?: number;
  tasks?: string[];
}

interface CaseReport {
  name: string;
  passed: boolean;
  details: CaseDetails;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service, of its database, or of a stand-in log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** The entries of a JSON-lines log that a stand-in writes. */
function entries<T>(path: string): T[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

type Service = InstanceType<typeof AgentService>;
type Mailbox = InstanceType<typeof MailboxStore>;
type Store = InstanceType<typeof AgentStore>;

interface Profile {
  agents: Service;
  store: Store;
  mailbox: Mailbox;
  sqlite: () => DatabaseSync;
}

/** Runs one case on its own temporary profile and service, where only `provider` is on. */
async function runCase(
  name: string,
  provider: AgentProviderId,
  run: (profile: Profile, details: CaseDetails) => Promise<void>,
  clientFactory?: AgentClientFactory,
): Promise<void> {
  const result: CaseReport = { name, passed: false, details: {} };
  report.cases.push(result);
  const database = new OpenBotDatabase(join(root, `user-data-${name}`));
  const store = new AgentStore(database.userDataPath, home, database);
  const mailbox = new MailboxStore(database.userDataPath, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: provider,
    offProviders: AGENT_PROVIDERS.filter((candidate) => candidate !== provider),
    timezone: () => "UTC",
    ...(clientFactory ? { clientFactory } : {}),
  });
  let connection: DatabaseSync | null = null;
  const sqlite = () => {
    connection ??= new DatabaseSync(database.path);
    return connection;
  };
  const closeReader = () => connection?.close();
  try {
    await runCauseEffect(agents.initialize());
    await run({ agents, store, mailbox, sqlite }, result.details);
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    await runCauseEffect(agents.stop()).catch(() => {});
    closeReader();
    database.close();
  }
}

const idle = (agents: Service, agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

/** Creates an agent whose first chat turn runs `initialMessage`, and waits for that turn to end. */
async function createAgent(agents: Service, name: string, provider: AgentProviderId, model?: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: `${name} checks provider session reuse.`,
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage: "first-turn",
      provider,
      ...(model ? { model } : {}),
    }),
  );
  await waitFor(`${name}: a delivery`, () => agents.listQueue(agent.id).deliveries.length > 0);
  await waitFor(`${name}: the first turn to end`, () => idle(agents, agent.id));
  return agent;
}

/** Sends one chat message and waits for its delivery to complete. */
async function sendTurn({ agents, mailbox }: Profile, agentId: string, text: string): Promise<void> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${text}: no delivery`);
  const status = await waitFor(`${text} to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  assert.equal(status, "completed", `${text}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
  await waitFor(`${text}: the queue to be idle`, () => idle(agents, agentId));
}

function sessionRows(sqlite: () => DatabaseSync, threadId: string) {
  return sqlite()
    .prepare(
      "SELECT external_session_id, state FROM projection_provider_sessions WHERE thread_id = ? ORDER BY created_at, rowid",
    )
    .all(threadId)
    .map((row) => ({ session: String(row.external_session_id), state: String(row.state) }));
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
await writeFile(mcpScript, "process.stdin.resume();\n");
await mkdir(join(agyInstall, "bin"), { recursive: true });
await writeFile(join(agyInstall, "antigravity-package.json"), `${JSON.stringify({ version: "1.4.3" })}\n`);
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });

try {
  await runCase(
    "claude-refresh-resumes",
    "claude",
    async (profile, details) => {
      const { agents, store, sqlite } = profile;
      const agent = await createAgent(agents, "Claude reuse", "claude", CLAUDE_MODEL);
      const threadId = await waitFor(
        "the agent's own thread",
        () => store.list().find((a) => a.id === agent.id)?.threadId,
      );
      const firstSpawn = await waitFor("the first Claude start", () => entries<{ sessionId: string }>(claudeSpawns)[0]);
      const firstSession = firstSpawn.sessionId;
      // The same call that an MCP server or a skill change makes. The second one finds the session
      // with no process: it must keep the session as well.
      await runCauseEffect(agents.refreshAllAgentRuntimes());
      await runCauseEffect(agents.refreshAllAgentRuntimes());
      const messagesBefore = entries(claudeMessages).length;
      await sendTurn(profile, agent.id, "second-turn");
      const spawns = entries<{ resume: string | null; sessionId: string }>(claudeSpawns);
      const secondMessage = entries<{ sessionId: string; text: string }>(claudeMessages)[messagesBefore];
      const rows = sessionRows(sqlite, threadId);
      details.sessionRows = rows;
      details.spawns = spawns.map((spawn) => ({ resume: spawn.resume, sessionId: spawn.sessionId }));
      details.secondTurnHasHandoff = secondMessage
        ? secondMessage.text.includes(HANDOFF_START) || secondMessage.text.includes(CURRENT_MESSAGE_SEPARATOR)
        : null;
      assert.equal(rows.length, 1, "The thread keeps one provider session.");
      assert.equal(rows[0]?.state, "active", "That session stays active.");
      assert.equal(rows[0]?.session, firstSession, "The session is the one of the first turn.");
      assert.equal(spawns.length, 2, "The refresh closes the process, and the second turn starts one.");
      assert.equal(spawns[1]?.resume, firstSession, "The second start resumes the session of the first turn.");
      assert.ok(secondMessage, "The stand-in got the second message.");
      assert.equal(secondMessage.sessionId, firstSession, "The second message goes to the same session.");
      assert.equal(details.secondTurnHasHandoff, false, "The second message has no history handoff.");
    },
    (_provider, cli) => new ClaudeStandIn(cli),
  );

  await runCase("codex-approval-grant-keeps-session", "codex", async (profile, details) => {
    const { agents } = profile;
    const server: McpServerConfig = {
      // A new server has no id yet. The store gives it one.
      id: "",
      name: "echo",
      transport: "stdio",
      enabled: true,
      command: process.execPath,
      args: [mcpScript],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    };
    // The entry that Codex keeps for this server: OpenBot's disabled placeholder, with the approvals.
    const key = codexMcpServerKey(server);
    const writeConfig = (tools: { echo: { approval_mode: "approve" | "prompt" } } | null) =>
      writeFileSync(
        codexConfig,
        JSON.stringify({
          [key]: { command: CODEX_PLACEHOLDER_COMMAND, enabled: false, ...(tools ? { tools } : {}) },
        }),
      );
    writeConfig(null);
    await runCauseEffect(agents.saveMcpServer({ config: server }));
    const starts = () =>
      entries<{ method: string }>(codexLog).filter((entry) => entry.method === "thread/start").length;
    await createAgent(agents, "Codex reuse", "codex");
    const agent = await waitFor("the Codex agent", () => profile.store.list().find((a) => a.provider === "codex"));
    const afterTurn1 = starts();
    writeConfig({ echo: { approval_mode: "approve" } });
    await sendTurn(profile, agent.id, "turn-after-grant");
    const afterGrantTurn2 = starts();
    writeConfig(null);
    await sendTurn(profile, agent.id, "turn-after-revoke");
    const afterRevokeTurn3 = starts();
    // A tool set to ask every time is stricter than no setting: the session must not keep running it.
    writeConfig({ echo: { approval_mode: "prompt" } });
    await sendTurn(profile, agent.id, "turn-after-prompt");
    const counts = { afterTurn1, afterGrantTurn2, afterRevokeTurn3, afterPromptTurn4: starts() };
    details.serverKey = key;
    details.threadStarts = counts;
    assert.equal(counts.afterTurn1, 1, "The first turn starts one Codex session.");
    assert.equal(counts.afterGrantTurn2, 1, "A granted approval keeps the Codex session.");
    assert.equal(counts.afterRevokeTurn3, 2, "A revoked approval replaces the Codex session.");
    assert.equal(counts.afterPromptTurn4, 3, "A tool set to ask every time replaces the Codex session.");
  });

  await runCase("antigravity-channel-delta", "antigravity", async (profile, details) => {
    const { agents } = profile;
    const agent = await createAgent(agents, "Gemini reuse", "antigravity");
    const actor = { id: "local", name: "Alex" };
    const channelId = randomUUID();
    await runCauseEffect(
      agents.channels.command(
        {
          type: "save",
          operationId: randomUUID(),
          channelId,
          draft: {
            name: "reuse",
            title: "",
            instructions: "Answer each request.",
            members: [{ agentId: agent.id }],
            leadAgentId: agent.id,
          },
        },
        actor,
      ),
    );
    const FIRST = "first-channel-request-7c1e";
    const SECOND = "second-channel-request-9b4d";
    // The agent compacts by itself during this turn, so the next packet is complete again.
    const THIRD = "third-channel-request-usage-drop-2f6a";
    // The context is nearly full after this turn, so OpenBot replaces the channel session.
    const FOURTH = "fourth-channel-request-usage-high-5d3c";
    const FIFTH = "fifth-channel-request-a81b";
    const prompts = () => entries<{ sessionId: string; length: number; text: string }>(agyLog);
    // The agent's first chat turn is in the log too.
    const beforeChannel = prompts().length;
    for (const text of [FIRST, SECOND, THIRD, FOURTH, FIFTH]) {
      await runCauseEffect(
        agents.channels.command(
          {
            type: "send",
            operationId: randomUUID(),
            channelId,
            text,
            recipientAgentId: agent.id,
            replyToMessageId: null,
            attachmentDraftIds: [],
          },
          actor,
        ),
      );
      await waitFor(`the channel prompt with ${text}`, () => prompts().some((prompt) => prompt.text.includes(text)));
      await waitFor(`the channel task of ${text} to end`, () =>
        agents.channels.store.tasks(channelId).every((task) => !["queued", "running", "waiting"].includes(task.state)),
      );
      await waitFor(`${text}: the queue to be idle`, () => idle(agents, agent.id));
    }
    const first = prompts().find((prompt) => prompt.text.includes(FIRST));
    const second = prompts().find((prompt) => prompt.text.includes(SECOND));
    assert.ok(first && second, "Both channel prompts reached Antigravity.");
    details.prompts = prompts().map((prompt) => ({ sessionId: prompt.sessionId, length: prompt.length }));
    details.firstPrompt = { sessionId: first.sessionId, length: first.length };
    details.secondPrompt = {
      sessionId: second.sessionId,
      length: second.length,
      repeatsFirstRequest: second.text.includes(FIRST),
    };
    details.tasks = agents.channels.store.tasks(channelId).map((task) => task.state);
    assert.equal(second.sessionId, first.sessionId, "Both channel prompts go to the same ACP session.");
    assert.ok(!second.text.includes(FIRST), "The second prompt has only the unread channel messages.");
    const fourth = prompts().find((prompt) => prompt.text.includes(FOURTH));
    const fifth = prompts().find((prompt) => prompt.text.includes(FIFTH));
    assert.ok(fourth && fifth, "The later channel prompts reached Antigravity.");
    details.afterCompaction = { sessionId: fourth.sessionId, repeatsFirstRequest: fourth.text.includes(FIRST) };
    details.afterRotation = { sessionId: fifth.sessionId, repeatsFirstRequest: fifth.text.includes(FIRST) };
    details.channelPromptCount = prompts().length - beforeChannel;
    assert.equal(fourth.sessionId, first.sessionId, "A compaction by the agent keeps the session.");
    assert.ok(fourth.text.includes(FIRST), "After the agent compacts, the next packet is complete.");
    assert.notEqual(fifth.sessionId, first.sessionId, "A nearly full channel session is replaced.");
    assert.ok(fifth.text.includes(FIRST), "The replacement channel session gets the complete packet.");
    // A channel summary would run as more prompts: the new session's unknown window must not shrink
    // the packet budget to a few characters.
    assert.equal(prompts().length - beforeChannel, 5, "Each channel message is one prompt, with no summary prompts.");
  });

  report.passed = report.cases.length === 3 && report.cases.every((entry) => entry.passed);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.cases) {
    process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name} ${JSON.stringify(entry.details)}\n`);
    if (entry.error) process.stdout.write(`${entry.error}\n`);
  }
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
