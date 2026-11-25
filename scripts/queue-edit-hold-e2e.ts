import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { HostMemory } from "../src/backend/host-memory";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/queue-edit-hold-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-queue-edit-hold-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const processLog = join(root, "claude.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

let clockOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockOffset;
let holdWakeDelay = Number.POSITIVE_INFINITY;
const holdWakes: Array<{ at: number; run: () => void }> = [];
const realSetTimeout = globalThis.setTimeout;
Object.defineProperty(globalThis, "setTimeout", {
  configurable: true,
  writable: true,
  value: (handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
    if (timeout !== holdWakeDelay) return realSetTimeout(handler, timeout, ...args);
    holdWakes.push({ at: Date.now() + timeout, run: () => handler(...args) });
    return realSetTimeout(() => {}, 0).unref();
  },
});
function moveClock(ms: number): number {
  clockOffset += ms;
  const due = holdWakes.filter((wake) => wake.at <= Date.now());
  for (const wake of due) holdWakes.splice(holdWakes.indexOf(wake), 1);
  for (const wake of due) wake.run();
  return due.length;
}

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore, QUEUE_EDIT_HOLD_MS } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
holdWakeDelay = QUEUE_EDIT_HOLD_MS + 1_000;

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
const log = (entry) => fs.appendFileSync(${JSON.stringify(processLog)}, JSON.stringify({ pid: process.pid, at: Date.now(), ...entry }) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const result = (text) => {
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  write({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] });
};
const turn = (message) => {
  const text = JSON.stringify(message.message?.content ?? "");
  log({ event: "turn", text });
  const slow = text.match(/SLOW-(\\d+)/);
  if (!slow) return result("Done.");
  const release = join(${JSON.stringify(root)}, "release-" + slow[1]);
  const timer = setInterval(() => {
    if (!fs.existsSync(release)) return;
    clearInterval(timer);
    result("Slow done.");
  }, 25);
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

  releaseQuietBackgroundThreads() {
    return this.#real.releaseQuietBackgroundThreads();
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

const memory: HostMemory = {
  level: () => "ok",
  turnLimit: () => 8,
  reserveTurn: () => () => {},
  subscribe: () => () => {},
  hostedPlan: false,
};
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
  const deadline = realNow() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (realNow() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => realSetTimeout(done, 25));
  }
}

function turnTexts(): string[] {
  if (!existsSync(processLog)) return [];
  return readFileSync(processLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line);
      return isDynamicRecord(entry) && typeof entry.text === "string" ? entry.text : "";
    });
}

interface Report {
  steps: Array<{ name: string; detail?: unknown }>;
  passed: boolean;
  error?: string;
}
const report: Report = { steps: [], passed: false };
const step = (name: string, detail?: unknown) => report.steps.push({ name, detail });

function open() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    hostMemory: memory,
    preferredProvider: "claude",
    busyMessageMode: () => "queue",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
  });
  return { database, store, agents };
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
let host = open();

try {
  await runCauseEffect(host.agents.initialize());
  const agent = await runCauseEffect(
    host.agents.createAgent({
      name: "Queue edit",
      description: "Checks how long a queue edit holds its message.",
      avatarSeed: "queue-edit-hold",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const queue = () => host.agents.listQueue(agent.id).deliveries;
  const byText = (text: string) => queue().find((delivery) => delivery.text === text);
  const status = (text: string) => byText(text)?.status;
  const brief = () =>
    queue().map((delivery) => `${delivery.text}:${delivery.status}${delivery.editing ? ":editing" : ""}`);
  const idle = () => !queue().some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  const settled = () => !queue().some((delivery) => ["starting", "running"].includes(delivery.status));
  const send = (text: string) => runCauseEffect(host.agents.sendMessage({ agentId: agent.id, text }));
  const edit = (input: Parameters<typeof host.agents.editQueuedMessage>[1]) =>
    runCauseEffect(host.agents.editQueuedMessage(agent.id, input));
  await waitFor("the first turn to end", idle);

  await send("SLOW-1 turn.");
  await waitFor("the slow turn", () => status("SLOW-1 turn.") === "running");
  await send("Edit me.");
  await send("After me.");
  const held = await waitFor("the queued message", () => byText("Edit me."));
  await edit({ action: "begin", deliveryId: held.id, editId: "edit-1" });
  writeFileSync(join(root, "release-1"), "");
  await waitFor("the slow turn to end", () => status("SLOW-1 turn.") === "completed");
  await waitFor("the queue to settle", settled);
  assert.equal(status("Edit me."), "queued", "The edited message waits for its edit.");
  assert.equal(status("After me."), "queued", "The message behind the edited one waits.");
  assert.equal(byText("Edit me.")?.editing, true, "The queue shows the edit.");
  step("edit holds the queue", brief());

  assert.equal(moveClock(QUEUE_EDIT_HOLD_MS / 2), 0, "No wake runs before the time.");
  await waitFor("the queue to settle", settled);
  assert.equal(status("Edit me."), "queued", "The edit still holds its message within the time.");
  assert.equal(moveClock(QUEUE_EDIT_HOLD_MS / 2 + 1_000), 1, "The wake of the hold runs at its time.");
  await waitFor("the held message to complete", () => status("Edit me.") === "completed");
  await waitFor("the next message to complete", () => status("After me.") === "completed");
  assert.equal(byText("Edit me.")?.editing, false, "The edit ended when the message started.");
  assert.ok(
    turnTexts().some((text) => text.includes("Edit me.")),
    "The message ran with its original text.",
  );
  await assert.rejects(
    edit({
      action: "save",
      deliveryId: held.id,
      editId: "edit-1",
      text: "Too late.",
      keepAttachmentIds: [],
      attachmentDraftIds: [],
    }),
    "A Save after the time is refused.",
  );
  assert.ok(!turnTexts().some((text) => text.includes("Too late.")), "A refused Save never reaches the agent.");
  step("time ends the hold", brief());

  await send("SLOW-2 turn.");
  await waitFor("the second slow turn", () => status("SLOW-2 turn.") === "running");
  await send("Restart save.");
  await send("Restart lost.");
  const saved = await waitFor("the first queued message", () => byText("Restart save."));
  const lost = await waitFor("the second queued message", () => byText("Restart lost."));
  await edit({ action: "begin", deliveryId: saved.id, editId: "edit-2" });
  await edit({ action: "begin", deliveryId: lost.id, editId: "edit-3" });
  holdWakes.length = 0;
  await runCauseEffect(host.agents.stop());
  host.database.close();
  writeFileSync(join(root, "release-2"), "");
  step("host stopped with two edits", { saved: saved.id, lost: lost.id });

  host = open();
  await runCauseEffect(host.agents.initialize());
  await waitFor("the startup wakes", () => holdWakes.length > 0);
  await waitFor("the queue to settle after the restart", () => status("SLOW-2 turn.") !== "running" && settled());
  assert.equal(status("Restart save."), "queued", "An edit from before the restart holds its message again.");
  assert.equal(byText("Restart save.")?.editing, true, "The queue shows the edit after the restart.");
  step("restart keeps the edits", brief());

  await edit({ action: "begin", deliveryId: saved.id, editId: "edit-2" });
  await edit({
    action: "save",
    deliveryId: saved.id,
    editId: "edit-2",
    text: "Restart save, edited.",
    keepAttachmentIds: [],
    attachmentDraftIds: [],
  });
  await waitFor("the saved message to complete", () => status("Restart save, edited.") === "completed");
  assert.ok(
    turnTexts().some((text) => text.includes("Restart save, edited.")),
    "The Save after the restart ran.",
  );
  await waitFor("the queue to settle", settled);
  assert.equal(status("Restart lost."), "queued", "The second edit still holds its message.");
  step("save after the restart", brief());

  assert.ok(moveClock(QUEUE_EDIT_HOLD_MS + 1_000) >= 1, "The startup wake runs at its time.");
  await waitFor("the lost edit's message to complete", () => status("Restart lost.") === "completed");
  assert.equal(byText("Restart lost.")?.editing, false, "The lost edit ended.");
  step("time ends the hold after a restart", brief());

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  step("failed", { turns: turnTexts().map((text) => text.slice(0, 120)) });
  process.exitCode = 1;
} finally {
  await runCauseEffect(host.agents.stop()).catch(() => {});
  host.database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
