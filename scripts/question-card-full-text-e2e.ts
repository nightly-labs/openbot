import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentPromptQuestion,
  defaultProviderModel,
} from "@openbot/contracts/ipc";
import { keepWholePrompts, withWholePromptText } from "@openbot/team-client/runtime-attention";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";
import {
  attentionKey,
  reconcileAttentionPrompts,
  withListedPrompts,
} from "../src/renderer/src/features/agents/agent-runtime-snapshot";
import { messagePromptRequestKey, promptRequestKey } from "../src/renderer/src/features/conversation/conversation-keys";

const OUT = resolve(import.meta.dirname, "../.openbot-build/question-card-full-text-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-question-full-text-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const askTrigger = join(root, "ask");
const standInLog = join(root, "stand-in.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const QUESTION = [
  "I found three files that read the start settings, and I can change only one of them in this step.",
  '1. "src/alpha/configuration-loader.ts" reads the settings file at start.',
  '2. "src/beta/network-request-handler.ts" sends the settings to the service.',
  '3. "src/gamma/user-interface-panel.tsx" shows them. Which one?',
].join(" ");
const THIRD_ITEM = "src/gamma/user-interface-panel.tsx";
const DESCRIPTION = `Change the third item only, ${"and keep the other two files as they are now ".repeat(4)}`.trim();
const CHOSEN = "Item 3";
const DONE = "I change the third item.";

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
const log = (event) => fs.appendFileSync(${JSON.stringify(standInLog)}, JSON.stringify(event) + "\\n");
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const assistant = (content) =>
  write(frame({ type: "assistant", uuid: randomUUID(), message: { id: "msg_" + randomUUID(), type: "message",
    role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)}, content, stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 } } }));
const result = (text) =>
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
let question = null;
let asked = false;
setInterval(() => {
  if (asked || !fs.existsSync(${JSON.stringify(askTrigger)})) return;
  asked = true;
  const toolUseId = "toolu_" + randomUUID().replaceAll("-", "");
  const input = { questions: [{ question: ${JSON.stringify(QUESTION)}, header: "File", multiSelect: false,
    options: [{ label: "Item 1", description: "Change the first item." },
      { label: ${JSON.stringify(CHOSEN)}, description: ${JSON.stringify(DESCRIPTION)} }] }] };
  assistant([{ type: "tool_use", id: toolUseId, name: "AskUserQuestion", input }]);
  question = "req_" + randomUUID();
  write({ type: "control_request", request_id: question,
    request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input, tool_use_id: toolUseId } });
}, 25).unref();
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
    } else if (message.type === "control_response" && question && message.response?.request_id === question) {
      log({ answers: message.response?.response?.updatedInput?.answers ?? null });
      question = null;
      assistant([{ type: "text", text: ${JSON.stringify(DONE)} }]);
      result(${JSON.stringify(DONE)});
    } else if (message.type === "user") {
      assistant([{ type: "text", text: "Started." }]);
      result("Started.");
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

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

interface ShownText {
  question: number;
  description: number;
  hasThirdItem: boolean;
}

const report: {
  sent?: ShownText;
  hostSummary?: ShownText;
  desktopAfterSnapshot?: ShownText;
  desktopAfterReload?: ShownText;
  webAfterSnapshot?: ShownText;
  webAfterReload?: ShownText;
  answerReceived?: unknown;
  resolved?: boolean;
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

const shownText = (questions: readonly AgentPromptQuestion[]): ShownText => {
  const question = questions[0];
  assert.ok(question, "The prompt has a question.");
  return {
    question: question.question.length,
    description: question.options?.find((option) => option.label === CHOSEN)?.description.length ?? 0,
    hasThirdItem: question.question.includes(THIRD_ITEM),
  };
};
const whole: ShownText = { question: QUESTION.length, description: DESCRIPTION.length, hasThirdItem: true };
const standInAnswers = () =>
  existsSync(standInLog)
    ? readFileSync(standInLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).answers)
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
let liveEvent: PromptEvent | undefined;
agents.on("event", (event) => {
  if (event.type === "prompt") liveEvent = event;
});
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Long question",
      description: "Checks that a long question card keeps its full text.",
      avatarSeed: "long-question",
      avatarHue: null,
      initialMessage: "Start.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const live = () => runCauseEffect(agents.readConversation(agent.id));
  await waitFor("the first turn to end", async () => !(await live()).activeTurnId);

  writeFileSync(askTrigger, "");
  const event = await waitFor("the live question", () => liveEvent);
  report.sent = shownText(event.questions);
  assert.deepEqual(report.sent, whole, "The live question has the full text.");

  const snapshot = agents.getRuntimeSnapshot();
  const listed = agents.pendingPrompts();
  report.hostSummary = shownText(listed[0]?.questions ?? []);
  assert.ok(report.hostSummary.question < whole.question, "The host summary of the question is shorter.");

  const saved = await waitFor("the saved question", async () => {
    const message = (await live()).messages.find(
      (item) => messagePromptRequestKey(item) === promptRequestKey(event.turnId, event.requestId),
    );
    return message?.questionPrompt?.questions;
  });

  const key = attentionKey(event.agentId, event.threadId);
  const desktopShown = reconcileAttentionPrompts({ [key]: event }, snapshot, {})[key];
  assert.equal(desktopShown?.type, "prompt", "The desktop still shows the question after a snapshot.");
  report.desktopAfterSnapshot = shownText(desktopShown.questions);
  assert.deepEqual(report.desktopAfterSnapshot, whole, "A snapshot keeps the full text on the desktop card.");

  const desktopListed = withListedPrompts({}, listed, {}, new Set())[key];
  assert.equal(desktopListed?.type, "prompt", "The desktop shows the listed question after a reload.");
  report.desktopAfterReload = shownText(withWholePromptText(desktopListed, saved).questions);
  assert.deepEqual(report.desktopAfterReload, whole, "After a reload, the desktop card shows the saved full text.");

  const webShown = keepWholePrompts(
    [event],
    snapshot.pendingPrompts.map((prompt) => ({ ...prompt, type: "prompt" as const })),
  )[0];
  assert.ok(webShown, "The web client still shows the question after a snapshot.");
  report.webAfterSnapshot = shownText(webShown.questions);
  assert.deepEqual(report.webAfterSnapshot, whole, "A snapshot keeps the full text on the web card.");

  const webListed = listed.map((prompt) => ({ ...prompt, type: "prompt" as const }))[0];
  assert.ok(webListed, "The web client gets the listed question after a reload.");
  report.webAfterReload = shownText(withWholePromptText(webListed, saved).questions);
  assert.deepEqual(report.webAfterReload, whole, "After a reload, the web card shows the saved full text.");

  const questionId = desktopShown.questions[0]?.id;
  assert.ok(questionId, "The shown question has an ID.");
  await runCauseEffect(agents.respondToPrompt({ requestId: event.requestId, answers: { [questionId]: [CHOSEN] } }));
  report.answerReceived = await waitFor("the answer in the CLI", () => standInAnswers()[0]);
  assert.deepEqual(report.answerReceived, { [QUESTION]: CHOSEN }, "The CLI gets the chosen option for the question.");
  report.resolved = await waitFor("the resolved question", async () =>
    (await live()).messages.some((item) => Boolean(item.questionPrompt?.resolution)),
  );
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
