import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const DROP = process.argv.includes("--drop");
const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-late-steer-e2e");
const REPORT = join(OUT, DROP ? "report-idle-release-exit.json" : "report-idle-release.json");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-steer-idle-release-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const holdMarker = join(root, "holding");
const windowMarker = join(root, "late-window");
const teammateMarker = join(root, "teammate-done");
const eventLog = join(root, "events.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const FIRST_ANSWER = "First task done.";
const STEERED_MESSAGE = "Please also answer this.";
const LATE_ANSWER = "Answer of the late steer.";

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
const log = (event) => fs.appendFileSync(${JSON.stringify(eventLog)}, JSON.stringify({ pid: process.pid, sessionId, ...event }) + "\\n");
const write = (message, done) => process.stdout.write(JSON.stringify(message) + "\\n", done);
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
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
};
const finish = (message, text, done) => {
  const uuid = randomUUID();
  const reply = { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
  write(frame({ uuid: randomUUID(), duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [], user_message_uuid: message.uuid,
    user_message_uuids: [message.uuid], subtype: "success", is_error: false, result: text, terminal_reason: "completed",
    type: "result" }), done);
};
const answerWhenTeammateDone = (message) => {
  const timer = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(teammateMarker)})) return;
    clearInterval(timer);
    log({ event: "late-answer", uuid: message.uuid });
    begin(message, ${JSON.stringify(LATE_ANSWER)});
    finish(message, ${JSON.stringify(LATE_ANSWER)});
  }, 20);
};
let held = null;
const turn = (message) => {
  const text = JSON.stringify(message.message);
  log({ event: "user-message", uuid: message.uuid, late: Boolean(held) });
  if (held) {
    const done = held;
    held = null;
    if (${JSON.stringify(DROP)}) {
      finish(done, ${JSON.stringify(FIRST_ANSWER)}, () => {
        log({ event: "exit" });
        process.exit(1);
      });
      return;
    }
    finish(done, ${JSON.stringify(FIRST_ANSWER)});
    fs.writeFileSync(${JSON.stringify(windowMarker)}, message.uuid);
    answerWhenTeammateDone(message);
    return;
  }
  if (text.includes("late-steer")) {
    begin(message, "Working.");
    held = message;
    fs.writeFileSync(${JSON.stringify(holdMarker)}, message.uuid);
    return;
  }
  const answer = text.includes(${JSON.stringify(STEERED_MESSAGE)}) ? ${JSON.stringify(LATE_ANSWER)} : "Done.";
  begin(message, answer);
  finish(message, answer);
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
process.stdin.on("end", () => {
  log({ event: "stdin-end" });
  process.exit(0);
});
`;

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
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => {
      this.emit("request", request);
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

interface StandInEvent {
  pid: number;
  sessionId: string;
  event: string;
  uuid?: string;
  late?: boolean;
}

const report: {
  mode: string;
  steerDeliveryId?: string;
  shown?: string[];
  deliveries?: Array<{ id: string; status: string }>;
  events?: StandInEvent[];
  passed: boolean;
  error?: string;
} = { mode: DROP ? "process-exit" : "idle-release-race", passed: false };

const events = (): StandInEvent[] =>
  existsSync(eventLog)
    ? readFileSync(eventLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
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
const shown = (agentId: string, threadId: string) =>
  database
    .readConversationPage(agentId, threadId, { type: "latest" }, 100)
    .messages.map((message) => message.text)
    .filter((text) => [FIRST_ANSWER, STEERED_MESSAGE, LATE_ANSWER, "Done."].includes(text));
const deliveries = (agentId: string) =>
  agents.listQueue(agentId).deliveries.map((delivery) => ({ id: delivery.id, status: delivery.status }));
const idle = (agentId: string) =>
  deliveries(agentId).every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
const threadOf = (agentId: string) => {
  const threadId = store.list().find((item) => item.id === agentId)?.threadId;
  assert.ok(threadId, "The agent has a chat thread.");
  return threadId;
};

try {
  await runCauseEffect(agents.initialize());
  const teammate = DROP
    ? null
    : await runCauseEffect(
        agents.createAgent({
          name: "Teammate",
          description: "Ends a turn while the worker holds a late steer.",
          avatarSeed: "teammate",
          avatarHue: null,
          initialMessage: "hello",
          provider: "claude",
          model: CLAUDE_MODEL,
        }),
      );
  if (teammate) {
    const teammateThread = threadOf(teammate.id);
    await waitFor(
      "the teammate's first answer",
      () => shown(teammate.id, teammateThread).includes("Done.") && idle(teammate.id),
    );
  }
  const worker = await runCauseEffect(
    agents.createAgent({
      name: "Worker",
      description: "Gets a steer that its turn does not read.",
      avatarSeed: "worker",
      avatarHue: null,
      initialMessage: "late-steer",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the stand-in to hold its turn", () => existsSync(holdMarker));
  const workerThread = threadOf(worker.id);
  await waitFor("the running turn", () => deliveries(worker.id).some((delivery) => delivery.status === "running"));
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: worker.id, text: STEERED_MESSAGE }));
  const steerDeliveryId = receipt.deliveries[0]?.id;
  assert.ok(steerDeliveryId, "The steered message has a delivery.");
  report.steerDeliveryId = steerDeliveryId;
  if (teammate) {
    await waitFor("the late-steer window", () => existsSync(windowMarker));
    await waitFor("the worker's first answer", () => shown(worker.id, workerThread).includes(FIRST_ANSWER));
    const teammateThread = threadOf(teammate.id);
    await runCauseEffect(agents.sendMessage({ agentId: teammate.id, text: "quick question" }));
    await waitFor(
      "the teammate's second answer",
      () => shown(teammate.id, teammateThread).filter((text) => text === "Done.").length === 2 && idle(teammate.id),
    );
    writeFileSync(teammateMarker, "done");
  }
  await waitFor(
    "the answer to the steered message",
    () => shown(worker.id, workerThread).includes(LATE_ANSWER) && idle(worker.id),
  );
  report.shown = shown(worker.id, workerThread);
  report.deliveries = deliveries(worker.id);
  report.events = events();
  assert.deepEqual(
    report.shown.filter((text) => text === STEERED_MESSAGE || text === LATE_ANSWER),
    [STEERED_MESSAGE, LATE_ANSWER],
    "The chat shows the steered message once and then its answer.",
  );
  assert.ok(
    report.deliveries.every((delivery) => delivery.status === "completed"),
    "Each delivery completes.",
  );
  const steerTurns = report.events.filter((event) => event.event === "user-message" && event.uuid === steerDeliveryId);
  if (DROP) {
    const exit = report.events.findIndex((event) => event.event === "exit");
    const exitedPid = report.events[exit]?.pid;
    assert.ok(exit >= 0, "Claude exits while it holds the steer.");
    assert.ok(
      report.events.slice(exit).some((event) => event.event === "user-message" && event.pid !== exitedPid),
      "The queue sends the steered message again to a new Claude process.",
    );
  } else {
    assert.equal(steerTurns.length, 1, "Claude gets the steer once.");
    const workerPid = steerTurns[0]?.pid;
    const lateAnswer = report.events.findIndex((event) => event.event === "late-answer" && event.pid === workerPid);
    const closed = report.events.findIndex((event) => event.event === "stdin-end" && event.pid === workerPid);
    assert.ok(lateAnswer >= 0, "The worker's Claude answers the late steer.");
    assert.ok(closed < 0 || closed > lateAnswer, "OpenBot keeps the worker's Claude open until it answers the steer.");
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  report.events = events();
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${REPORT}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
