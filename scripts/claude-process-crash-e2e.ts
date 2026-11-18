// Checks that a Claude turn whose CLI process crashes continues once in the agent's chat (#12175).
// Claude Code 2.1.327 on Windows stopped with a Bun "Segmentation fault" and exit code 3 in the
// middle of a turn. The turn failed at once with the raw CLI text, and the agent did not continue.
// Runs the real agent service on a temporary profile. Claude is the real `ClaudeAgentClient`, which
// the Claude Agent SDK connects to a stand-in `claude` executable. Checks:
//   1. A crash after the first part of the answer: the turn continues once with the provider-exit
//      note, the chat shows the continuation line, and the message completes with no error.
//   2. A crash in the continuation too: the message fails with the plain text, not the CLI's stderr,
//      after one continuation only.
//   3. A crash of a new process before it sends anything, which also stops the shared Claude client:
//      the same as check 1.
// `bun run test:claude-process-crash`. Writes .openbot-build/claude-process-crash-e2e/report.json.
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-process-crash-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-process-crash-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const claudeExecutable = join(root, "claude");
const logPath = join(root, "stand-in.jsonl");
const crashAgainMarker = join(root, "crash-again");
const CLAUDE_MODEL = defaultProviderModel("claude");
const PANIC = "panic: Segmentation fault at address 0x40";
const COMPLETE_ANSWER = "Complete answer.";

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

// The stand-in for the Claude CLI. A message that names a crash makes it exit with code 3 and Bun's
// panic on stderr, as Claude Code 2.1.327 did. The provider-exit note gets the complete answer.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.327 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
const transcript = join(${JSON.stringify(projectsDir)}, sessionId + ".jsonl");
const log = (entry) => fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
log({ start: true });
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
const crash = () => {
  process.stderr.write(${JSON.stringify(`${PANIC}\n`)});
  // After stdout reaches the SDK, so the first part of the answer shows before the exit.
  process.stdout.write("", () => setTimeout(() => process.exit(3), 100));
};
const turn = (message) => {
  const text = JSON.stringify(message.message);
  log({ prompt: text });
  if (text.includes("OpenBot note")) {
    if (fs.existsSync(${JSON.stringify(crashAgainMarker)})) {
      fs.rmSync(${JSON.stringify(crashAgainMarker)});
      begin(message, "Second part of the answer.");
      crash();
      return;
    }
    begin(message, ${JSON.stringify(COMPLETE_ANSWER)});
    finish(message, ${JSON.stringify(COMPLETE_ANSWER)});
    return;
  }
  if (text.includes("crash-at-start")) {
    crash();
    return;
  }
  if (text.includes("crash-after-text") || text.includes("crash-twice")) {
    if (text.includes("crash-twice")) fs.writeFileSync(${JSON.stringify(crashAgainMarker)}, "1");
    begin(message, "First part of the answer.");
    crash();
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

interface CaseResult {
  status: string | null;
  deliveryError: string | null;
  notes: number;
  continuationLine: boolean;
  completeAnswer: boolean;
  /** The errors of the agent: its chat shows them. */
  shownErrors: string[];
  /**
   * The errors of the provider row, which no chat shows. A process that sent nothing stops the shared
   * Claude client, as a CLI that cannot start does, and its exit shows there as for any provider.
   */
  providerErrors: string[];
}

const report: {
  crashAfterText?: CaseResult;
  crashAtStart?: CaseResult;
  crashTwice?: CaseResult;
  passed: boolean;
  failures: string[];
  error?: string;
} = { passed: false, failures: [] };

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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const standInLog = (): { pid: number; start?: true; prompt?: string }[] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
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
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
});
const errors: { agentId: string | null; message: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error") errors.push({ agentId: event.agentId ?? null, message: event.message });
});
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Crash",
      description: "Checks a Claude turn whose CLI process crashes.",
      avatarSeed: "crash",
      avatarHue: null,
      initialMessage: "First message.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn to end", () => standInLog().some((line) => line.prompt) && idle(agent.id));
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  if (!threadId) throw new Error("The agent has no chat thread.");
  const continuationText = sourceText("status.agent.providerExitContinues");

  const runCase = async (text: string): Promise<CaseResult> => {
    const notesBefore = standInLog().filter((line) => line.prompt?.includes("OpenBot note")).length;
    const errorsBefore = errors.length;
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    await waitFor(`the message "${text}" to reach the stand-in`, () =>
      standInLog().some((line) => line.prompt?.includes(text)),
    );
    const delivery = await waitFor(`the message "${text}" to settle`, () => {
      const found = agents.listQueue(agent.id).deliveries.find((item) => item.text === text);
      return found && ["completed", "failed", "interrupted", "cancelled"].includes(found.status) && idle(agent.id)
        ? found
        : null;
    });
    const shown = database.readConversationPage(agent.id, threadId, { type: "latest" }, 200).messages;
    const turnStart = shown.findLastIndex((message) => message.author === "user" && message.text === text);
    const after = shown.slice(turnStart + 1);
    return {
      status: delivery.status,
      deliveryError: delivery.error ?? null,
      notes: standInLog().filter((line) => line.prompt?.includes("OpenBot note")).length - notesBefore,
      continuationLine: after.some((message) => message.text === continuationText),
      completeAnswer: after.some((message) => message.author === "assistant" && message.text === COMPLETE_ANSWER),
      shownErrors: errors
        .slice(errorsBefore)
        .filter((error) => error.agentId === agent.id)
        .map((error) => error.message),
      providerErrors: errors
        .slice(errorsBefore)
        .filter((error) => error.agentId !== agent.id)
        .map((error) => error.message),
    };
  };
  const leaked = (result: CaseResult) =>
    [...result.shownErrors, result.deliveryError ?? ""].some(
      (message) => message.includes("Segmentation") || message.includes("exited with code"),
    );
  const check = (label: string, result: CaseResult) => {
    if (result.status !== "completed") report.failures.push(`${label}: the message ended as ${result.status}.`);
    if (result.notes !== 1) report.failures.push(`${label}: ${result.notes} continuation notes, not 1.`);
    if (!result.continuationLine) report.failures.push(`${label}: the chat shows no continuation line.`);
    if (!result.completeAnswer) report.failures.push(`${label}: the chat shows no complete answer.`);
    if (result.shownErrors.length > 0)
      report.failures.push(`${label}: errors shown: ${result.shownErrors.join(" | ")}`);
  };

  report.crashAfterText = await runCase("crash-after-text");
  check("crash after text", report.crashAfterText);
  report.crashTwice = await runCase("crash-twice");
  if (report.crashTwice.status !== "failed")
    report.failures.push(`crash twice: the message ended as ${report.crashTwice.status}, not failed.`);
  if (report.crashTwice.notes !== 1)
    report.failures.push(`crash twice: ${report.crashTwice.notes} continuation notes, not 1.`);
  if (report.crashTwice.shownErrors.length === 0) report.failures.push("crash twice: no error shown.");
  if (leaked(report.crashTwice)) report.failures.push("crash twice: the shown error has the CLI's crash text.");
  // The crash in the continuation ended the process, so this message starts a new one, which crashes
  // before it sends anything. That also stops the shared Claude client, which starts again.
  report.crashAtStart = await runCase("crash-at-start");
  check("crash at start", report.crashAtStart);
  report.passed = report.failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
