import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const HELD_TAKEOVER = process.argv.includes("--held=takeover");
const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-steer-now-e2e");
const REPORT = join(OUT, HELD_TAKEOVER ? "report-takeover.json" : "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-steer-now-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const holdMarker = join(root, "holding");
const priorityLog = join(root, "priorities.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const WORKING_TEXT = "Starting the long command.";
const STEERED_ANSWER = "Answer of the steered message.";
const STEERED_MESSAGE = "Steered message.";
const HELD_TOOL_ID = "toolu_held_command";
const heldToolEvents: Array<{ method: string; turnId: string | null; status: string | null }> = [];
const HELD_HOST_TOOL = HELD_TAKEOVER ? "tool_call" : "list_agents";
const HELD_HOST_ARGUMENTS = HELD_TAKEOVER
  ? { name: "openbot_browser.request_takeover", arguments: { tabId: "tab-1", reason: "sign-in-blocked" } }
  : {};
const heldHostToolCalls: Array<{ signal: AbortSignal; answer: (result: unknown) => void }> = [];

function recordHeldTool(notification: AppServerNotification): void {
  const params = notification.params;
  if (typeof params !== "object" || params === null || !("item" in params)) return;
  const item = params.item;
  if (typeof item !== "object" || item === null || !("id" in item) || item.id !== HELD_TOOL_ID) return;
  heldToolEvents.push({
    method: notification.method,
    turnId: "turnId" in params && typeof params.turnId === "string" ? params.turnId : null,
    status: "status" in item && typeof item.status === "string" ? item.status : null,
  });
}

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.CLAUDE_CONFIG_DIR = claudeConfig;
mkdirSync(projectsDir, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.330 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
const transcript = join(${JSON.stringify(projectsDir)}, sessionId + ".jsonl");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let parentUuid = null;
const save = (entry) => {
  fs.appendFileSync(transcript, JSON.stringify({ ...entry, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false }) + "\\n");
  parentUuid = entry.uuid;
};
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const begin = (message, text) => {
  save({ type: "user", uuid: message.uuid, message: message.message });
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } }));
  write(frame({ type: "stream_event", uuid: randomUUID(),
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
};
const assistant = (message, content, stopReason) => {
  const uuid = randomUUID();
  const reply = { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content, stop_reason: stopReason, usage: { input_tokens: 1, output_tokens: 1 } };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
};
const result = (message, fields) => write(frame({ uuid: randomUUID(), duration_ms: 1, duration_api_ms: 1, num_turns: 1,
  total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [],
  user_message_uuid: message.uuid, user_message_uuids: [message.uuid], ...fields, type: "result" }));
const finish = (message, text) => {
  assistant(message, [{ type: "text", text }], "end_turn");
  result(message, { subtype: "success", is_error: false, result: text, terminal_reason: "completed" });
};
let held = null;
let waiting = null;
const finishHeld = () => {
  const done = held;
  const next = waiting;
  held = null;
  waiting = null;
  if (!next) return finish(done, "Done.");
  begin(next, ${JSON.stringify(STEERED_ANSWER)});
  assistant(next, [{ type: "text", text: ${JSON.stringify(STEERED_ANSWER)} }], "end_turn");
  result(next, { subtype: "success", is_error: false, result: ${JSON.stringify(STEERED_ANSWER)},
    terminal_reason: "completed", user_message_uuids: [done.uuid, next.uuid] });
};
const turn = (message) => {
  fs.appendFileSync(${JSON.stringify(priorityLog)}, JSON.stringify({ uuid: message.uuid, priority: message.priority ?? null }) + "\\n");
  if (held && message.priority === "now") {
    const stopped = held;
    held = null;
    result(stopped, { subtype: "error_during_execution", is_error: true, errors: [], terminal_reason: "aborted_tools" });
    begin(message, ${JSON.stringify(STEERED_ANSWER)});
    finish(message, ${JSON.stringify(STEERED_ANSWER)});
    return;
  }
  if (held) {
    waiting = message;
    return;
  }
  if (JSON.stringify(message.message).includes("steer-now")) {
    begin(message, ${JSON.stringify(WORKING_TEXT)});
    assistant(message, [{ type: "text", text: ${JSON.stringify(WORKING_TEXT)} },
      { type: "tool_use", id: ${JSON.stringify(HELD_TOOL_ID)}, name: "Bash", input: { command: "sleep 600" } }], "tool_use");
    write({ type: "control_request", request_id: "req_held_host_tool", request: { subtype: "mcp_message", server_name: "openbot",
      message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: ${JSON.stringify(HELD_HOST_TOOL)}, arguments: ${JSON.stringify(HELD_HOST_ARGUMENTS)} } } } });
    held = message;
    fs.writeFileSync(${JSON.stringify(holdMarker)}, message.uuid);
    return;
  }
  begin(message, "Done.");
  finish(message, "Done.");
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
    else if (message.type === "control_response" && message.response?.request_id === "req_held_host_tool" && held)
      finishHeld();
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

function isHeldHostToolCall(request: AppServerRequest): boolean {
  const params = request.params;
  return (
    request.method === "item/tool/call" &&
    typeof params === "object" &&
    params !== null &&
    "tool" in params &&
    params.tool === HELD_HOST_TOOL
  );
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      recordHeldTool(notification);
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => {
      if (isHeldHostToolCall(request) && request.signal)
        heldHostToolCalls.push({ signal: request.signal, answer: (result) => this.#real.respond(request.id, result) });
      else this.emit("request", request);
    });
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

interface TurnRow {
  turnId: string;
  status: string;
}

const report: {
  steerDeliveryId?: string;
  priorities?: Array<{ uuid: string; priority: string | null }>;
  turns?: TurnRow[];
  deliveries?: Array<{ id: string; status: string }>;
  shown?: string[];
  heldToolEvents?: typeof heldToolEvents;
  heldHostToolCallAborted?: boolean;
  passed: boolean;
  error?: string;
} = { passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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

function startService() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    busyMessageMode: () => "steer",
    clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
  });
  let connection: DatabaseSync | null = null;
  const sqlite = () => {
    connection ??= new DatabaseSync(database.path);
    return connection;
  };
  const turns = (threadId: string): TurnRow[] =>
    sqlite()
      .prepare("SELECT turn_id, status FROM projection_turns WHERE thread_id = ? ORDER BY started_at")
      .all(threadId)
      .map((row) => ({ turnId: String(row.turn_id), status: String(row.status) }));
  const shown = (agentId: string, threadId: string) =>
    database
      .readConversationPage(agentId, threadId, { type: "latest" }, 100)
      .messages.map((message) => message.text)
      .filter((text) => [WORKING_TEXT, STEERED_MESSAGE, STEERED_ANSWER].includes(text));
  const deliveries = (agentId: string) =>
    agents.listQueue(agentId).deliveries.map((delivery) => ({ id: delivery.id, status: delivery.status }));
  const idle = (agentId: string) =>
    !deliveries(agentId).some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  const stop = async () => {
    await runCauseEffect(agents.stop()).catch(() => {});
    connection?.close();
    database.close();
  };
  return { store, agents, turns, shown, deliveries, idle, stop };
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
const service = startService();
try {
  await runCauseEffect(service.agents.initialize());
  const agent = await runCauseEffect(
    service.agents.createAgent({
      name: "Steer now",
      description: "Checks a steer while a Claude tool call runs.",
      avatarSeed: "steer-now",
      avatarHue: null,
      initialMessage: "steer-now",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the stand-in to hold its tool call", () => existsSync(holdMarker));
  const threadId = service.store.list().find((item) => item.id === agent.id)?.threadId;
  assert.ok(threadId, "The agent has a chat thread.");
  await waitFor("the held tool call to start", () => heldToolEvents.length > 0);
  await waitFor("the held host tool call to start", () => heldHostToolCalls.length > 0);
  const receipt = await runCauseEffect(service.agents.sendMessage({ agentId: agent.id, text: STEERED_MESSAGE }));
  const steerDeliveryId = receipt.deliveries[0]?.id;
  assert.ok(steerDeliveryId, "The steered message has a delivery.");
  report.steerDeliveryId = steerDeliveryId;
  if (HELD_TAKEOVER) {
    await waitFor("the steer to reach Claude", () => readFileSync(priorityLog, "utf8").trim().split("\n").length === 2);
    assert.equal(heldHostToolCalls[0]?.signal.aborted, false, "The steer keeps the sign-in card open.");
    heldHostToolCalls[0]?.answer({
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify({ status: "completed" }) }],
    });
  }
  await waitFor(
    "the steered answer",
    () => service.shown(agent.id, threadId).includes(STEERED_ANSWER) && service.idle(agent.id),
  );
  report.priorities = readFileSync(priorityLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  report.turns = service.turns(threadId);
  report.deliveries = service.deliveries(agent.id);
  report.shown = service.shown(agent.id, threadId);
  report.heldToolEvents = heldToolEvents;
  report.heldHostToolCallAborted = heldHostToolCalls.every((call) => call.signal.aborted);
  assert.equal(report.priorities.length, 2, "Claude gets the first message and the steer.");
  assert.equal(report.priorities[0]?.priority, null, "The first message has no priority.");
  assert.equal(
    report.priorities[1]?.priority,
    HELD_TAKEOVER ? null : "now",
    HELD_TAKEOVER ? "The steer waits for the sign-in card." : "The steer stops the running tool call.",
  );
  assert.ok(
    report.turns.every((turn) => turn.status === "completed"),
    "No OpenBot turn ends as interrupted when Claude stops its tools for a steer.",
  );
  assert.ok(
    report.deliveries.every((delivery) => delivery.status === "completed"),
    "Each delivery completes.",
  );
  assert.deepEqual(
    report.shown,
    [WORKING_TEXT, STEERED_MESSAGE, STEERED_ANSWER],
    "The chat shows the steered message and then its answer.",
  );
  assert.deepEqual(
    report.heldToolEvents.map((event) => event.method),
    ["item/started", "item/completed"],
    "The stopped tool call starts and then ends.",
  );
  assert.equal(
    report.heldToolEvents[1]?.turnId,
    report.heldToolEvents[0]?.turnId,
    "The stopped tool call ends in the turn that started it.",
  );
  assert.equal(heldHostToolCalls.length, 1, "The stand-in makes one host tool call.");
  assert.equal(
    report.heldHostToolCallAborted,
    !HELD_TAKEOVER,
    HELD_TAKEOVER
      ? "The sign-in card stays until the person answers it."
      : "The host stops the tool call that Claude dropped, so its approval card goes away.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await service.stop();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${REPORT}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
