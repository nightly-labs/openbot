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

const OUT = resolve(import.meta.dirname, "../.openbot-build/steer-before-turn-id-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-steer-before-turn-id-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const standInLog = join(root, "stand-in.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const WORK = "Please refactor the parser.";
const STEER = "Also keep the old function names.";
const STEERED_ANSWER = "Done, and the old names stay.";

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.CLAUDE_CONFIG_DIR = claudeConfig;
mkdirSync(claudeConfig, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

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
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const log = (event) => fs.appendFileSync(${JSON.stringify(standInLog)}, JSON.stringify({ event }) + "\\n");
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const begin = (message, text) => {
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } }));
  write(frame({ type: "stream_event", uuid: randomUUID(),
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
};
const finish = (message, text) => {
  const reply = { id: "msg_" + message.uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  write(frame({ type: "assistant", uuid: randomUUID(), message: reply, user_message_uuid: message.uuid }));
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
};
let working = null;
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
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
      continue;
    }
    if (message.type !== "user") continue;
    const text = JSON.stringify(message.message);
    if (text.includes(${JSON.stringify(WORK)})) {
      log("work");
      working = message;
      begin(message, "Working.");
    } else if (working && text.includes(${JSON.stringify(STEER)})) {
      log("steer-during-turn");
      finish(working, "Working.");
      working = null;
      begin(message, ${JSON.stringify(STEERED_ANSWER)});
      finish(message, ${JSON.stringify(STEERED_ANSWER)});
    } else {
      log(working ? "other-during-turn" : "other");
      begin(message, "Started.");
      finish(message, "Started.");
    }
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

interface Signal {
  promise: Promise<void>;
  resolve: () => void;
}

interface HeldStart {
  entered: Signal;
  release: Signal;
}

function signal(): Signal {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let heldStart: HeldStart | null = null;
let releaseHeldStart = () => {};
let turnStarts = 0;
let failNextInterrupt = false;

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
      case "turn/start": {
        turnStarts += 1;
        const held = heldStart;
        if (!held) return this.#real.request(method, params, decoder, timeoutMs);
        heldStart = null;
        return Effect.suspend(() => {
          held.entered.resolve();
          return Effect.promise(() => held.release.promise);
        }).pipe(Effect.andThen(this.#real.request(method, params, decoder, timeoutMs)));
      }
      case "turn/interrupt":
        if (!failNextInterrupt) return this.#real.request(method, params, decoder, timeoutMs);
        failNextInterrupt = false;
        return providerSync(() => {
          throw new Error("The stand-in refuses this stop.");
        });
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

const report: {
  standInEvents?: string[];
  steerStatusWhileStarting?: string;
  activeTurnWhileStarting?: string | null;
  turnStarts?: number;
  steerStatus?: string;
  steerFallback?: string | null;
  failedStop?: { refused: string; standInEvents: string[]; turnStarts: number; steerFallback: string | null };
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

async function waitFor<T>(
  label: string,
  read: () => Promise<T | null | undefined | false> | T | null | undefined | false,
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

const standInEvents = () =>
  existsSync(standInLog)
    ? readFileSync(standInLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => String(JSON.parse(line).event))
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
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Early steer",
      description: "Checks a message sent before the running turn has an id.",
      avatarSeed: "early-steer",
      avatarHue: null,
      initialMessage: "Start.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const live = () => runCauseEffect(agents.readConversation(agent.id));
  const delivery = (id: string) => agents.listQueue(agent.id).deliveries.find((item) => item.id === id);
  const idle = async () =>
    !(await live()).activeTurnId &&
    !agents
      .listQueue(agent.id)
      .deliveries.some((item) => ["queued", "starting", "running", "steering"].includes(item.status));
  await waitFor("the first turn to end", idle);

  const held: HeldStart = { entered: signal(), release: signal() };
  heldStart = held;
  releaseHeldStart = () => held.release.resolve();
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: WORK }));
  await held.entered.promise;

  const steer = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: STEER }));
  const steerId = steer.deliveries[0]?.id;
  assert.ok(steerId, "The second message has a delivery.");
  report.steerStatusWhileStarting = delivery(steerId)?.status;
  report.activeTurnWhileStarting = (await live()).activeTurnId;
  assert.equal(report.steerStatusWhileStarting, "queued", "The second message waits while the turn starts.");
  assert.equal(report.activeTurnWhileStarting, null, "The turn has no id while it starts.");
  held.release.resolve();

  await waitFor("the steered answer and the end of all turns", async () => {
    const conversation = await live();
    return conversation.messages.some((message) => message.text === STEERED_ANSWER) && (await idle());
  });
  report.standInEvents = standInEvents();
  assert.deepEqual(
    report.standInEvents,
    ["other", "work", "steer-during-turn"],
    "The second message joins the running turn.",
  );
  report.turnStarts = turnStarts;
  report.steerStatus = delivery(steerId)?.status;
  report.steerFallback = delivery(steerId)?.steerFallback ?? null;
  assert.equal(report.turnStarts, 2, "The second message starts no turn of its own.");
  assert.equal(report.steerFallback, null, "The second message does not fall back to the queue.");

  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: WORK }));
  await waitFor("the second work turn", () => standInEvents().length === 4);
  const runningTurnId = await waitFor("the running turn id", async () => (await live()).activeTurnId);
  failNextInterrupt = true;
  const refused = await runCauseEffect(agents.interrupt(agent.id, runningTurnId)).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(refused, "The stand-in refuses the stop.");
  const afterStop = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: STEER }));
  const afterStopId = afterStop.deliveries[0]?.id;
  assert.ok(afterStopId, "The message after the failed stop has a delivery.");
  await waitFor("the steer after the failed stop and the end of all turns", async () => {
    return standInEvents().length === 5 && (await idle());
  });
  report.failedStop = {
    refused,
    standInEvents: standInEvents().slice(3),
    turnStarts,
    steerFallback: delivery(afterStopId)?.steerFallback ?? null,
  };
  assert.deepEqual(report.failedStop.standInEvents, ["work", "steer-during-turn"], "A failed stop keeps steering.");
  assert.equal(report.failedStop.turnStarts, 3, "The message after the failed stop starts no turn of its own.");
  report.passed = true;
} catch (error) {
  report.standInEvents ??= standInEvents();
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  releaseHeldStart();
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
