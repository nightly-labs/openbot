// Checks that a provider error moves an agent set to switch without asking to its next backup model,
// and that read_agent shows the move (#2834). Runs the real agent service on a temporary profile. Claude is the real `ClaudeAgentClient`,
// which the Claude Agent SDK connects to a stand-in `claude` executable. The stand-in answers each
// message on its current model, and fails it with the CLI's report of an Anthropic overload (529)
// when that model is in `failing.json`. A message with `act-then-fail` writes text before it fails.
// Checks:
//   1. A turn that wrote text before the error does not move: it fails with its error, as before.
//   2. An agent with no backup models fails with its error, as before.
//   3. A turn that did nothing yet runs again on the backup model, with a note and no error.
//   4. read_agent shows the backup model, and the model to go back to with the provider error as cause.
//   5. After a restart, the agent goes back to its own model, with a note.
// Also checks continuation after a usage limit interrupts partial work.
// `bun run test:backup-model-failover`. Writes .openbot-build/backup-model-failover-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentBackupModels,
  type AgentEvent,
  type AgentModelId,
  defaultProviderModel,
  MODEL_SWITCH_ITEM_TYPES,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/backup-model-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-backup-model-failover-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const turnLog = join(root, "claude-turns.jsonl");
const failingFile = join(root, "failing.json");
const claudeExecutable = join(root, "claude");
const codexExecutable = join(root, "codex");
const codexLog = join(root, "codex-turns.jsonl");
const workLog = join(root, "work.jsonl");
const CODEX_MODEL = defaultProviderModel("codex");
const PRIMARY: AgentModelId = defaultProviderModel("claude");
const BACKUP: AgentModelId = PRIMARY === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
// The text the Claude CLI writes in an outage. It names no HTTP status phrase, only the 529 and its type.
const PROVIDER_ERROR =
  'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_e2e"}';

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
process.env.OPENBOT_CODEX_PATH = codexExecutable;
process.env.CODEX_HOME = join(home, ".codex");
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { CodexAppServerClient } = await import("../src/backend/app-server-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { importProviderHistory } = await import("../src/backend/provider-history-import");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end,
// and logs the model and the outcome of each turn.
const STAND_IN_CLAUDE = `#!/usr/bin/env node
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
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
let model = option("--model");
const project = require("node:path").join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
fs.mkdirSync(project, { recursive: true });
const transcript = require("node:path").join(project, sessionId + ".jsonl");
const previous = fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8").trim().split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const recorded = new Set(previous.map((row) => row.uuid));
let parentUuid = previous.at(-1)?.uuid ?? null;
const record = (message) => {
  if (recorded.has(message.uuid)) return;
  const row = { ...message, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false };
  fs.appendFileSync(transcript, JSON.stringify(row) + "\\n");
  recorded.add(row.uuid);
  parentUuid = row.uuid;
};
const write = (message) => {
  if (message.type === "assistant") record(message);
  process.stdout.write(JSON.stringify(message) + "\\n");
};
const result = (fields) =>
  write({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), duration_ms: 1,
    duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    permission_denials: [], modelUsage: {}, ...fields });
const assistant = (text) =>
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
const turn = (message) => {
  record(message);
  const failing = JSON.parse(fs.readFileSync(${JSON.stringify(failingFile)}, "utf8"));
  const fails = failing.includes(model);
  const input = JSON.stringify(message);
  const acts = input.includes("act-then-fail");
  fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: fails, input }) + "\\n");
  if ((input.includes("usage-work") || input.includes("usage-chain") || input.includes("usage-exhausted")) &&
      (model === ${JSON.stringify(PRIMARY)} || input.includes("usage-exhausted"))) {
    if (!input.includes("usage-chain-empty")) assistant("Checkpoint saved. Only the final step remains.");
    result({ is_error: true, result: "You've hit your limit. Try again later." });
    return;
  }
  if (fails) {
    if (acts) assistant("Partial answer.");
    result({ is_error: true, result: ${JSON.stringify(PROVIDER_ERROR)} });
    return;
  }
  const caseId = /case:([a-z-]+)/.exec(input)?.[1];
  if (caseId) {
    const saved = fs.existsSync(${JSON.stringify(workLog)}) && fs.readFileSync(${JSON.stringify(workLog)}, "utf8").split("\\n").filter(Boolean).some((line) => { const step = JSON.parse(line); return step.caseId === caseId && step.step === "checkpoint"; });
    const continued = input.includes("Continue the unfinished task") &&
      (input.includes("checkpoint-result=" + caseId) || (input.includes("Full tool results are unavailable") && input.includes("save-checkpoint " + caseId) && saved));
    fs.appendFileSync(${JSON.stringify(workLog)}, JSON.stringify({ caseId, step: continued ? "final" : "repeated-checkpoint" }) + "\\n");
  }
  assistant("Done.");
  result({ is_error: false, result: "Done." });
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
    if (message.type === "control_request") {
      if (message.request?.subtype === "set_model") model = message.request.model ?? model;
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    } else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

// Codex's app-server reports a plan refusal through the nested usageLimitExceeded error. The
// process writes a checkpoint before the refusal and serves it from the paged rollout endpoints.
const STAND_IN_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
if (process.argv.includes("--version")) { console.log("codex-cli 0.160.1"); process.exit(0); }
const threads = new Map();
const active = new Map();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const answer = (request) => {
  const params = request.params ?? {};
  const reply = (result) => write({ id: request.id, result });
  const thread = threads.get(params.threadId) ?? { id: params.threadId, turns: [] };
  switch (request.method) {
    case "initialize": return reply({});
    case "account/read": return reply({ account: { type: "chatgpt", email: "codex@example.com" } });
    case "account/rateLimits/read": return reply({ rateLimits: { limitId: "codex", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: null }, rateLimitsByLimitId: null });
    case "model/list": return reply({ data: [{ model: ${JSON.stringify(CODEX_MODEL)}, displayName: "Codex" }] });
    case "plugin/list": return reply({ marketplaces: [] });
    case "config/read": return reply(config);
    case "config/batchWrite": return reply({});
    case "thread/start": {
      const thread = { id: randomUUID(), turns: [] };
      threads.set(thread.id, thread);
      return reply({ thread });
    }
    case "thread/resume":
    case "thread/read": return reply({ thread });
    case "thread/unsubscribe": return reply({ status: "Unsubscribed" });
    case "thread/turns/list":
      if (thread.turns.some((turn) => turn.input?.includes("usage-slow-history"))) return;
      if (thread.turns.some((turn) => turn.input?.includes("usage-unreadable"))) return write({ id: request.id, error: { code: -32002, message: "History could not be read." } });
      return reply({ data: thread.turns.toReversed(), nextCursor: null });
    case "thread/items/list": return reply({ data: (thread.turns.find((turn) => turn.id === params.turnId)?.items ?? []).map((item) => ({ turnId: params.turnId, item })), nextCursor: null });
    case "turn/start": {
      const turn = { id: randomUUID(), status: "inProgress", items: [] };
      thread.turns.push(turn);
      const input = JSON.stringify(params.input);
      const current = input.split("--- current message ---").at(-1);
      turn.input = current;
      const limited = current.includes("usage-");
      const caseId = /case:([a-z-]+)/.exec(current)?.[1] ?? "no-case";
      fs.appendFileSync(${JSON.stringify(codexLog)}, JSON.stringify({ model: params.model, threadId: thread.id, turnId: turn.id, input, limited }) + "\\n");
      reply({ turn });
      write({ method: "turn/started", params: { threadId: thread.id, turn: { id: turn.id } } });
      const item = (item) => { turn.items.push(item); write({ method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } }); };
      const finish = (status) => { turn.status = status; write({ method: "turn/completed", params: { threadId: thread.id, turn } }); };
      active.set(turn.id, finish);
      setImmediate(() => {
        if (limited && !current.includes("usage-empty")) {
          fs.appendFileSync(${JSON.stringify(workLog)}, JSON.stringify({ caseId, step: "checkpoint" }) + "\\n");
          item({ type: "commandExecution", id: randomUUID(), command: "save-checkpoint " + caseId, cwd: params.cwd, status: "completed", exitCode: 0, aggregatedOutput: "checkpoint-result=" + caseId });
          if (!current.includes("usage-tool-only")) item({ type: "agentMessage", id: randomUUID(), phase: "commentary", text: "Checkpoint saved for " + caseId + ". Only the final step remains." });
        }
        if (current.includes("usage-wait")) return;
        if (limited) {
          const error = { message: "You've hit your usage limit. Try again later.", codexErrorInfo: "usageLimitExceeded" };
          turn.error = error;
          write({ method: "error", params: { threadId: thread.id, turnId: turn.id, error, willRetry: false } });
          finish("failed");
        } else {
          item({ type: "agentMessage", id: randomUUID(), phase: "final_answer", text: "Done." });
          finish("completed");
        }
        active.delete(turn.id);
      });
      return;
    }
    case "turn/interrupt": reply({}); active.get(params.turnId)?.("interrupted"); active.delete(params.turnId); return;
    default: return write({ id: request.id, error: { code: -32601, message: "Method not found: " + request.method } });
  }
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.id !== undefined && request.method) answer(request);
  }
});
process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); else throw error; });
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. It also records the provider thread of the last turn, and
 * keeps the answers to the tool calls this check sends as the provider would.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;
  /** The provider thread of the last turn that started. */
  lastThread: string | null = null;
  readonly toolAnswers = new Map<RequestId, unknown>();

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (notification.method === "turn/started" && isDynamicRecord(notification.params)) {
        const threadId = notification.params.threadId;
        if (typeof threadId === "string") this.lastThread = threadId;
      }
      this.emit("notification", notification);
    });
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
        return providerSync(() =>
          decoder({
            data: [
              { model: PRIMARY, displayName: "Primary" },
              { model: BACKUP, displayName: "Backup" },
            ],
          }),
        );
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, result);
    else this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, { error });
    else this.#real.respondError(id, error);
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const report: {
  primary: string;
  backup: string;
  checks: Check[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = {
  primary: PRIMARY,
  backup: BACKUP,
  checks: [],
  passed: false,
};

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

/** Waits for a state of the service or of its database. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turns(): { model: string; failed: boolean; input: string }[] {
  try {
    return readFileSync(turnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const failing = (models: string[]) => writeFileSync(failingFile, JSON.stringify(models));

function readLog<T>(path: string): T[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

interface CodexTurn {
  model: string;
  threadId: string;
  turnId: string;
  input: string;
  limited: boolean;
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
await writeFile(codexExecutable, STAND_IN_CODEX, { mode: 0o755 });
failing([]);
const database = new OpenBotDatabase(userData);
const clients: ClaudeStandIn[] = [];
const events: AgentEvent[] = [];

function startService() {
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude" && provider !== "codex"),
    clientFactory: (provider, cli) => {
      if (provider === "codex") return new CodexAppServerClient(cli.executable, 30000);
      const client = new ClaudeStandIn(cli);
      clients.push(client);
      return client;
    },
  });
  service.on("event", (event) => events.push(event));
  return { store, mailbox, service };
}

let { store, mailbox, service } = startService();

function agentOf(agentId: string) {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Agent ${agentId} exists.`);
  return agent;
}

function errorsFor(agentId: string, since: number) {
  return events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

/** Sends a message and waits for its delivery to end. */
async function send(agentId: string, text: string, sourcePaths?: string[]) {
  const attachments = await runCauseEffect(mailbox.prepareAttachments(sourcePaths ?? []));
  const receipt = await runCauseEffect(
    service.sendMessage({ agentId, text, attachmentDraftIds: attachments.map((attachment) => attachment.id) }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`"${text}" to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" ? value : null;
  });
  return { deliveryId, status, error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null };
}

/** The name the service lists for a model, which the switch notes show. */
function modelName(model: string): string {
  return service.listModels().find((option) => option.provider === "claude" && option.id === model)?.name ?? model;
}

async function markers(agentId: string, itemType: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  return snapshot.messages.filter((message) => message.itemType === itemType).map((message) => message.text);
}

/** Calls an OpenBot tool from the thread of the last turn, as its provider would, and returns the answer. */
let toolCalls = 0;
async function callTool(tool: string, args: unknown) {
  const client = clients.at(-1);
  assert.ok(client, "The service made a Claude client.");
  const thread = client.lastThread;
  assert.ok(thread, "A turn ran.");
  const id = `e2e-tool-${++toolCalls}`;
  client.emit("request", {
    id,
    method: "item/tool/call",
    params: { threadId: thread, turnId: "e2e-turn", callId: id, namespace: "openbot", tool, arguments: args },
  });
  const answer = await waitFor(`${tool} to answer`, () => client.toolAnswers.get(id));
  assert.ok(isDynamicRecord(answer) && Array.isArray(answer.contentItems), `${tool} answers with content.`);
  const item = answer.contentItems[0];
  assert.ok(isDynamicRecord(item) && typeof item.text === "string", `${tool} answers with text.`);
  return { success: answer.success === true, text: item.text };
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

async function restart() {
  await runCauseEffect(service.stop());
  ({ store, mailbox, service } = startService());
  await runCauseEffect(service.initialize());
}

async function createCodex(name: string, backupModels?: AgentBackupModels) {
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks usage-limit continuation.",
      avatarSeed: randomUUID(),
      avatarHue: null,
      provider: "codex",
      model: CODEX_MODEL,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the initial Codex turn to end", () =>
    service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  if (backupModels) await runCauseEffect(service.updateAgent({ agentId: agent.id, backupModels }));
  return agentOf(agent.id);
}

const automaticBackups: AgentBackupModels = {
  automatic: true,
  order: [
    { provider: "claude", model: PRIMARY },
    { provider: "claude", model: BACKUP },
  ],
};

async function verifyHistoryKeepsRequests(agentId: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  const threadId = snapshot.threadId;
  assert.ok(threadId);
  const users = () =>
    database
      .readConversation(agentId, threadId)
      .messages.filter((message) => message.author === "user")
      .map((message) => ({ id: message.id, text: message.text }))
      .sort((left, right) => left.id.localeCompare(right.id));
  const before = users();
  const client = clients.at(-1);
  const session = database.listProviderSessions(threadId).find((session) => session.state === "active");
  assert.ok(client && session);
  const imported = await runCauseEffect(
    importProviderHistory({
      database,
      readHistory: client.readHistory.bind(client),
      sessionId: session.id,
      provider: "claude",
      externalSessionId: session.externalSessionId,
      agentId,
      publicThreadId: threadId,
      cwd: agentOf(agentId).workspacePath,
      findDelivery: (id) => mailbox.deliveryForProviderMessage(agentId, id),
      findMessageDelivery: (id) => mailbox.deliveryForMessage(id, agentId),
      quietRoutineDelivery: () => false,
    }),
  );
  assert.ok(imported.turns > 0, "The provider's saved transcript was read and imported.");
  assert.deepEqual(users(), before, "History import keeps one user request after independent continuation turn IDs.");
}

try {
  await runCauseEffect(service.initialize());
  const create = (name: string) =>
    runCauseEffect(
      service.createAgent({
        name,
        description: "Checks backup models.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "claude",
        model: PRIMARY,
      }),
    );
  const mover = await create("Mover");
  const stayer = await create("Stayer");
  await waitFor(
    "the first turns to end",
    () =>
      turns().length >= 2 &&
      !service
        .listQueue(mover.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)) &&
      !service
        .listQueue(stayer.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
  );
  await runCauseEffect(
    service.updateAgent({
      agentId: mover.id,
      backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
    }),
  );
  failing([PRIMARY]);

  await check("a turn that wrote text does not move", async () => {
    const since = events.length;
    const outcome = await send(mover.id, "act-then-fail");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(mover.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(mover.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("an agent with no backup models fails as before", async () => {
    const since = events.length;
    const outcome = await send(stayer.id, "work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(stayer.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(stayer.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("a provider error moves the agent to its backup model", async () => {
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "work");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, BACKUP, "The agent is on the backup model.");
    assert.equal(agent.usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.equal(agent.usageLimitReturn?.cause, "provider-error", "The return names the provider error.");
    assert.deepEqual(errorsFor(mover.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) })]);
    return { ran, notes };
  });

  // `agent-profile-accounts-e2e.ts` checks that update_profile sets and clears the order.
  await check("read_agent shows that a provider error moved the agent", async () => {
    const read = await callTool("read_agent", { agentId: mover.id });
    assert.ok(read.success, read.text);
    const setup = JSON.parse(read.text);
    assert.equal(setup.model, BACKUP, "read_agent shows the backup model.");
    assert.equal(setup.usageLimitReturn?.model, PRIMARY, "read_agent names the model to go back to.");
    assert.equal(setup.usageLimitReturn?.cause, "provider-error", "read_agent names the provider error.");
    return { model: setup.model, usageLimitReturn: setup.usageLimitReturn };
  });

  await check("after a restart the agent goes back to its own model", async () => {
    await runCauseEffect(service.stop());
    failing([]);
    ({ store, mailbox, service } = startService());
    await runCauseEffect(service.initialize());
    const before = turns().length;
    const outcome = await send(mover.id, "again");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "The message runs on the own model.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, PRIMARY, "The agent is back on its own model.");
    assert.equal(agent.usageLimitReturn, undefined, "Nothing is left to go back to.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelReturnedAfterError", { model: modelName(PRIMARY) })]);
    return { notes };
  });

  await check("a usage limit after partial work continues on the backup", async () => {
    const attachment = join(root, "requirements.txt");
    await writeFile(attachment, "Finish the last step after the checkpoint.\n");
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "usage-work: save a checkpoint, then finish the last step.", [attachment]);
    assert.equal(outcome.status, "completed", `The interrupted task completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
    );
    assert.ok(ran[1]?.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
    assert.ok(ran[1]?.input.includes("requirements.txt"), "The original attachment still reaches the backup.");
    const snapshot = await runCauseEffect(service.readConversation(mover.id));
    assert.equal(snapshot.messages.filter((message) => message.id === outcome.deliveryId).length, 1);
    assert.ok(snapshot.messages.some((message) => message.text.includes("Checkpoint saved.")));
    assert.deepEqual(errorsFor(mover.id, since), [], "A recovered usage limit shows no failure.");
    assert.ok(snapshot.threadId);
    await verifyHistoryKeepsRequests(mover.id);
    const finalTurnId = mailbox.getDelivery(outcome.deliveryId)?.delivery.turnId;
    assert.ok(finalTurnId);
    assert.equal(
      mailbox.deliveryForProviderMessage(stayer.id, finalTurnId),
      null,
      "History lookup never borrows another agent's delivery.",
    );
    return { outcome, models: ran.map((turn) => turn.model) };
  });

  for (const mode of ["partial", "tool-only", "chain", "chain-empty"]) {
    await check(`Codex ${mode} work continues on another provider`, async () => {
      await restart();
      const agent = await createCodex(`Codex ${mode}`, automaticBackups);
      const since = events.length;
      const beforeCodex = readLog<CodexTurn>(codexLog).length;
      const beforeClaude = turns().length;
      const beforeWork = readLog<{ caseId: string; step: string }>(workLog).length;
      const attachment = join(root, `${mode}.txt`);
      await writeFile(attachment, "Only the remaining step is needed.\n");
      const outcome = await send(agent.id, `usage-${mode} case:${mode}`, [attachment]);
      assert.equal(outcome.status, "completed", `The task completes on its backup: ${outcome.error}`);
      const attempts = readLog<CodexTurn>(codexLog).slice(beforeCodex);
      assert.equal(attempts.length, 1, "The spent provider is not run again.");
      const backups = turns().slice(beforeClaude);
      assert.deepEqual(
        backups.map((turn) => turn.model),
        mode.startsWith("chain") ? [PRIMARY, BACKUP] : [PRIMARY],
      );
      const last = backups.at(-1)?.input ?? "";
      assert.ok(last.includes("Continue the unfinished task"));
      assert.ok(
        last.includes(`checkpoint-result=${mode}`),
        "The completed tool result reaches the final provider, even without an answer bubble.",
      );
      assert.ok(last.includes(`${mode}.txt`), "The attachment reaches the final provider.");
      assert.deepEqual(
        readLog<{ caseId: string; step: string }>(workLog).slice(beforeWork),
        [
          { caseId: mode, step: "checkpoint" },
          { caseId: mode, step: "final" },
        ],
        "The completed action runs once; the backup runs only the remaining action.",
      );
      const snapshot = await runCauseEffect(service.readConversation(agent.id));
      assert.equal(snapshot.messages.filter((message) => message.id === outcome.deliveryId).length, 1);
      assert.equal(agentOf(agent.id).threadId, agent.threadId, "The public conversation is preserved.");
      assert.equal(
        agentOf(agent.id).usageLimitReturn?.provider,
        "codex",
        "A chain keeps the original return provider.",
      );
      assert.deepEqual(errorsFor(agent.id, since), []);
      const continuation = mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit;
      assert.ok(continuation?.workSteps.includes(`checkpoint-result=${mode}`));
      await verifyHistoryKeepsRequests(agent.id);
      await restart();
      assert.deepEqual(
        mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit,
        continuation,
        "The continuation survives a process restart.",
      );
      assert.equal(
        "resumeAfterUsageLimit" in (mailbox.getDelivery(outcome.deliveryId)?.delivery ?? {}),
        false,
        "Internal continuation state is not added to the queue contract.",
      );
      return { outcome, backups: backups.map((turn) => turn.model), checkpoint: mode };
    });
  }

  for (const automatic of [false, true]) {
    await check(
      automatic
        ? "without a backup, partial work fails without replay"
        : "automatic fallback off leaves partial work stopped",
      async () => {
        await restart();
        const agent = await createCodex(`No fallback ${automatic}`, {
          automatic,
          order: automatic ? [] : automaticBackups.order,
        });
        const before = turns().length;
        const beforeCodex = readLog<CodexTurn>(codexLog).length;
        const outcome = await send(agent.id, "usage-partial case:stopped");
        assert.equal(outcome.status, "failed");
        assert.equal(turns().length, before, "No backup runs.");
        assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1, "The original action is not replayed.");
        assert.equal(agentOf(agent.id).provider, "codex");
        return outcome;
      },
    );
  }

  await check("an exhausted backup chain ends without cycling", async () => {
    await restart();
    const agent = await createCodex("Exhausted", automaticBackups);
    const before = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const outcome = await send(agent.id, "usage-exhausted case:exhausted");
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY, BACKUP],
    );
    assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1);
    return outcome;
  });

  await check("Stop ends an active task without starting a backup", async () => {
    await restart();
    const agent = await createCodex("Stopped", automaticBackups);
    const before = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const receipt = await runCauseEffect(service.sendMessage({ agentId: agent.id, text: "usage-wait case:cancelled" }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId);
    const active = await waitFor("the task to start", () => readLog<CodexTurn>(codexLog).slice(beforeCodex)[0]);
    await waitFor("the first action to finish", () =>
      readLog<{ caseId: string; step: string }>(workLog).some((step) => step.caseId === "cancelled"),
    );
    await runCauseEffect(service.interrupt(agent.id, active.turnId));
    await waitFor(
      "Stop to settle the delivery",
      () => mailbox.getDelivery(deliveryId)?.delivery.status === "interrupted",
    );
    assert.equal(turns().length, before, "Stop does not fall back.");
    return { status: mailbox.getDelivery(deliveryId)?.delivery.status };
  });

  // In the chain, the first backup's plan refuses the continuation before any work.
  for (const { mode, caseId, models } of [
    { mode: "tool-only", caseId: "channel", models: [PRIMARY] },
    { mode: "chain-empty", caseId: "channel-chain", models: [PRIMARY, BACKUP] },
  ]) {
    await check(
      mode === "tool-only"
        ? "a channel keeps its task and completed work through fallback"
        : "a channel keeps its completed work when a backup refuses before work",
      async () => {
        await restart();
        const agent = await createCodex(`Channel ${mode}`, automaticBackups);
        const channelId = randomUUID();
        const actor = { id: "local", name: "Alex" };
        await runCauseEffect(
          service.channels.command(
            {
              type: "save",
              operationId: randomUUID(),
              channelId,
              draft: {
                name: "Continuation",
                title: "",
                instructions: "Finish the assigned work.",
                members: [{ agentId: agent.id }],
                leadAgentId: agent.id,
              },
            },
            actor,
          ),
        );
        const before = turns().length;
        await runCauseEffect(
          service.channels.command(
            {
              type: "send",
              operationId: randomUUID(),
              channelId,
              text: `usage-${mode} case:${caseId}`,
              recipientAgentId: agent.id,
              replyToMessageId: null,
              attachmentDraftIds: [],
            },
            actor,
          ),
        );
        const task = await waitFor("the channel task to end", () =>
          service.channels.store
            .tasks(channelId)
            .find((task) => ["completed", "failed", "paused"].includes(task.state)),
        );
        assert.equal(
          task.state,
          "completed",
          JSON.stringify({
            task,
            assignments: service.channels.store.assignments(channelId),
            deliveries: service.channels.store
              .assignments(channelId)
              .map((assignment) => (assignment.deliveryId ? mailbox.getDelivery(assignment.deliveryId) : null)),
          }),
        );
        assert.equal(service.channels.store.tasks(channelId).length, 1, "Fallback keeps one task.");
        const backups = turns().slice(before);
        assert.deepEqual(
          backups.map((turn) => turn.model),
          models,
        );
        const last = backups.at(-1)?.input ?? "";
        assert.ok(last.includes(`checkpoint-result=${caseId}`), "The channel backup receives the tool result.");
        assert.ok(last.includes("Continue the unfinished task"));
        return { taskId: task.id, state: task.state };
      },
    );
  }

  await check("a turn refused before work still runs on its backup", async () => {
    await restart();
    const agent = await createCodex("Before work", automaticBackups);
    const before = turns().length;
    const outcome = await send(agent.id, "usage-empty");
    assert.equal(outcome.status, "completed", outcome.error ?? "The original request completes.");
    assert.equal(turns().length, before + 1);
    assert.equal(
      mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit,
      undefined,
      "A request with no work is retried normally.",
    );
    return outcome;
  });

  await check("a task keeps its conversation and completed work through fallback", async () => {
    await restart();
    const agent = await createCodex("Task fallback", automaticBackups);
    const before = turns().length;
    const task = await runCauseEffect(service.startTask({ agentId: agent.id, text: "usage-tool-only case:task" }));
    await waitFor(
      "the task to complete on its backup",
      () =>
        turns().length > before &&
        service.readTask(agent.id, task.id).messages.some((message) => message.text === "Done."),
    );
    const snapshot = service.readTask(agent.id, task.id);
    assert.equal(snapshot.threadId, task.threadId);
    assert.ok(turns()[before]?.input.includes("checkpoint-result=task"));
    assert.ok(turns()[before]?.input.includes("Continue the unfinished task"));
    assert.equal(service.listTasks(agent.id).tasks.length, 1);
    return { taskId: task.id, threadId: snapshot.threadId };
  });

  for (const mode of ["unreadable", "slow-history"]) {
    await check(`unavailable ${mode} history does not block continuation`, async () => {
      await restart();
      const agent = await createCodex(`History ${mode}`, automaticBackups);
      const before = turns().length;
      const beforeWork = readLog<{ caseId: string; step: string }>(workLog).length;
      const outcome = await send(agent.id, `usage-${mode} case:${mode}`);
      assert.equal(outcome.status, "completed", outcome.error ?? "The backup can inspect the saved work.");
      const input = turns()[before]?.input ?? "";
      assert.ok(
        input.includes("Full tool results are unavailable"),
        "Missing history is stated, not represented as complete empty history.",
      );
      assert.ok(
        input.includes(`save-checkpoint ${mode} (completed)`),
        "Observed completed steps still reach the backup.",
      );
      assert.deepEqual(readLog<{ caseId: string; step: string }>(workLog).slice(beforeWork), [
        { caseId: mode, step: "checkpoint" },
        { caseId: mode, step: "final" },
      ]);
      return outcome;
    });
  }

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
