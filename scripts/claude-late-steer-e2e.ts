// Checks that a message steered into a Claude turn as the turn ends is stored one time (#3365). Runs
// the real agent service on a temporary profile, with the busy-message mode "steer". Claude is the
// real `ClaudeAgentClient`, which the Claude Agent SDK connects to a stand-in `claude` executable.
// Like the real CLI, the stand-in saves the session history, and a message that arrives after the
// turn's last request runs as a new turn of its own, whose first frames carry the message's uuid.
// The stand-in holds its first turn's answer until the steer arrives. After both turns, the service
// starts again and imports the session history. Before this change, the import added the steered
// answer a second time: the live turn had a random id, and the history names the turn by the uuid.
// `bun run test:claude-late-steer`. Writes .openbot-build/claude-late-steer-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-late-steer-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-late-steer-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const holdMarker = join(root, "holding");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const OLD_ANSWER = "Answer of the running turn.";
const STEERED_ANSWER = "Answer of the steered message.";
const STEERED_MESSAGE = "Steered message.";

// Before the service modules load: the stores and the CLI search read these. The history reader
// finds the transcript in CLAUDE_CONFIG_DIR, as Bun's `homedir()` does not follow HOME.
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

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end,
// and saves each user and assistant entry as the CLI's session transcript does.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
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
const transcript = join(${JSON.stringify(projectsDir)}, sessionId + ".jsonl");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let parentUuid = null;
const save = (entry) => {
  fs.appendFileSync(transcript, JSON.stringify({ ...entry, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false }) + "\\n");
  parentUuid = entry.uuid;
};
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
/** Starts the answer to a user message: the first stream event names the message it answers. */
const begin = (message, text) => {
  save({ type: "user", uuid: message.uuid, message: message.message });
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } }));
  write(frame({ type: "stream_event", uuid: randomUUID(),
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
};
const finish = (message, text) => {
  const uuid = randomUUID();
  const reply = { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
};
/** The turn whose last answer is still being written, which ends when the next message arrives. */
let held = null;
const turn = (message) => {
  if (held) {
    // The answer was written before the steer arrived, so the CLI ends that turn and runs the
    // steer as a turn of its own.
    finish(held, ${JSON.stringify(OLD_ANSWER)});
    held = null;
    begin(message, ${JSON.stringify(STEERED_ANSWER)});
    finish(message, ${JSON.stringify(STEERED_ANSWER)});
    return;
  }
  if (JSON.stringify(message.message).includes("late-steer")) {
    begin(message, ${JSON.stringify(OLD_ANSWER)});
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
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. Sessions, turns, history and events go to the real client.
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

interface StoredAnswer {
  messageId: string;
  turnId: string | null;
}

const report: {
  steerDeliveryId?: string;
  live?: { old: StoredAnswer[]; steered: StoredAnswer[] };
  afterImport?: { old: StoredAnswer[]; steered: StoredAnswer[] };
  passed: boolean;
  error?: string;
} = { passed: false };

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

/** Waits for a state of the service, of its database or of the stand-in. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** One run of the service on the profile, as one start of the app. */
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
  /** The stored messages of the chat with this author and text. */
  const messages = (threadId: string, author: string, text: string): StoredAnswer[] =>
    sqlite()
      .prepare(
        `SELECT message_id, turn_id FROM projection_thread_messages
         WHERE thread_id = ? AND author = ? AND json_extract(message_json, '$.text') = ?
         ORDER BY created_at, ordinal`,
      )
      .all(threadId, author, text)
      .map((row) => ({ messageId: String(row.message_id), turnId: row.turn_id === null ? null : String(row.turn_id) }));
  const answers = (threadId: string, text: string) => messages(threadId, "assistant", text);
  const idle = (agentId: string) =>
    !agents
      .listQueue(agentId)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  const stop = async () => {
    await runCauseEffect(agents.stop()).catch(() => {});
    connection?.close();
    database.close();
  };
  return { database, store, agents, messages, answers, idle, stop };
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
let service: ReturnType<typeof startService> | null = startService();
try {
  const first = service;
  await runCauseEffect(first.agents.initialize());
  const agent = await runCauseEffect(
    first.agents.createAgent({
      name: "Late steer",
      description: "Checks a steer at the end of a Claude turn.",
      avatarSeed: "late-steer",
      avatarHue: null,
      initialMessage: "late-steer",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  // The running turn has written its answer and has not ended.
  await waitFor("the stand-in to hold its answer", () => existsSync(holdMarker));
  const threadId = first.store.list().find((item) => item.id === agent.id)?.threadId;
  assert.ok(threadId, "The agent has a chat thread.");
  const receipt = await runCauseEffect(first.agents.sendMessage({ agentId: agent.id, text: STEERED_MESSAGE }));
  const steerDeliveryId = receipt.deliveries[0]?.id;
  assert.ok(steerDeliveryId, "The steered message has a delivery.");
  report.steerDeliveryId = steerDeliveryId;
  await waitFor("both turns to end", () => first.answers(threadId, STEERED_ANSWER).length > 0 && first.idle(agent.id));
  report.live = { old: first.answers(threadId, OLD_ANSWER), steered: first.answers(threadId, STEERED_ANSWER) };
  assert.equal(report.live.steered.length, 1, "The live chat shows the steered answer one time.");
  assert.equal(
    report.live.steered[0]?.turnId,
    steerDeliveryId,
    "The CLI's turn for the steer keeps the uuid of the steered message.",
  );
  const sessions = first.database.listProviderSessions(threadId).map((session) => session.id);
  assert.equal(sessions.length, 1, "The chat has one Claude session.");
  await first.stop();
  service = null;

  // The next start imports the session history.
  const second = startService();
  service = second;
  const restartedAt = new Date().toISOString();
  await runCauseEffect(second.agents.initialize());
  await waitFor("the history import", () => {
    const imported = second.database.providerHistoryImport(sessions[0] ?? "");
    return imported?.state === "complete" && imported.updatedAt >= restartedAt;
  });
  report.afterImport = { old: second.answers(threadId, OLD_ANSWER), steered: second.answers(threadId, STEERED_ANSWER) };
  assert.equal(report.afterImport.old.length, 1, "The running turn's answer is stored one time.");
  assert.equal(report.afterImport.steered.length, 1, "The steered answer is stored one time after the import.");
  assert.equal(
    second.messages(threadId, "user", STEERED_MESSAGE).length,
    1,
    "The steered message is stored one time after the import.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await service?.stop();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
