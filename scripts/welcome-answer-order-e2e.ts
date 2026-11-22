import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { AGENT_PROVIDERS, AGENT_WELCOME_ITEM_TYPE, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/welcome-answer-order-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-welcome-answer-order-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const standInLog = join(root, "stand-in.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const QUESTION = "Hi, I plan your days. Where do we start?";
const ANSWER = "Plan my week around three long walks.";
const REPLY = "Here is a week with three long walks.";
const SHOWN_ORDER = [`Question: ${QUESTION}`, ANSWER, REPLY];

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
const assistant = (content, extra = {}) =>
  write(frame({ type: "assistant", uuid: randomUUID(), ...extra, message: { id: "msg_" + randomUUID(), type: "message",
    role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)}, content, stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1 } } }));
const result = (text) =>
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
const start = (message) =>
  write(frame({ type: "stream_event", uuid: randomUUID(), user_message_uuid: message.uuid, user_message_uuids: [message.uuid],
    event: { type: "message_start", message: { id: "msg_" + message.uuid, type: "message", role: "assistant", content: [] } } }));
let question = null;
let welcomed = false;
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
      log("question-result");
      question = null;
      assistant([{ type: "text", text: ${JSON.stringify(REPLY)} }]);
      result(${JSON.stringify(REPLY)});
    } else if (message.type === "user") {
      if (welcomed) {
        log("extra-user-message");
        start(message);
        assistant([{ type: "text", text: "Extra." }], { user_message_uuid: message.uuid });
        result("Extra.");
        continue;
      }
      welcomed = true;
      log("welcome");
      start(message);
      const toolUseId = "toolu_" + randomUUID().replaceAll("-", "");
      const input = { questions: [{ question: ${JSON.stringify(QUESTION)}, header: "Start", multiSelect: false,
        options: [{ label: "Plan today", description: "A plan for today" }, { label: "Plan tomorrow", description: "A plan for tomorrow" }] }] };
      assistant([{ type: "tool_use", id: toolUseId, name: "AskUserQuestion", input }], { user_message_uuid: message.uuid });
      question = "req_" + randomUUID();
      write({ type: "control_request", request_id: question,
        request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input, tool_use_id: toolUseId } });
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

const report: {
  standInEvents?: string[];
  questionTurnId?: string;
  answer?: { id: string; author: string; turnId: string | null };
  shownLive?: string[];
  shownStored?: string[];
  shownRemoteSort?: string[];
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
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
});
const checked = (text: string) => SHOWN_ORDER.find((shown) => text.startsWith(shown));
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent(
      {
        name: "Day planner",
        description: "Plans the user's days.",
        avatarSeed: "welcome-answer",
        avatarHue: null,
        initialMessage: agentWelcomeMessage({ language: "English" }),
        provider: "claude",
        model: CLAUDE_MODEL,
      },
      undefined,
      undefined,
      undefined,
      true,
    ),
  );
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  assert.ok(threadId, "The agent has a chat thread.");
  const live = () => runCauseEffect(agents.readConversation(agent.id));
  const card = await waitFor("the welcome question card", async () =>
    (await live()).messages.find((message) => message.questionPrompt),
  );
  const prompt = card.questionPrompt;
  const questionId = prompt?.questions[0]?.id;
  assert.ok(prompt && questionId && card.turnId, "The card has a question and a turn.");
  report.questionTurnId = card.turnId;
  await waitFor("the welcome message in the question's turn", async () =>
    (await live()).messages.some(
      (message) => message.itemType === AGENT_WELCOME_ITEM_TYPE && message.turnId === card.turnId,
    ),
  );

  await runCauseEffect(agents.respondToPrompt({ requestId: prompt.requestId, answers: { [questionId]: [ANSWER] } }));
  const idle = async () =>
    !(await live()).activeTurnId &&
    !agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  await waitFor(
    "the reply and the end of the turn",
    async () => (await live()).messages.some((message) => message.text === REPLY) && (await idle()),
  );

  report.standInEvents = standInEvents();
  assert.deepEqual(report.standInEvents, ["welcome", "question-result"], "The CLI gets the answer only once.");
  const conversation = await live();
  const answers = conversation.messages.filter((message) => message.text === ANSWER);
  assert.equal(answers.length, 1, "The chat has one message with the answer.");
  const answer = answers[0];
  assert.ok(answer);
  report.answer = { id: answer.id, author: answer.author, turnId: answer.turnId ?? null };
  assert.equal(answer.author, "user", "The answer is the user's own message.");
  assert.equal(answer.turnId, card.turnId, "The answer stays in the welcome turn.");
  report.shownLive = conversation.messages.flatMap((message) => checked(message.text) ?? []);
  assert.deepEqual(report.shownLive, SHOWN_ORDER, "The live chat shows the answer under the question.");
  const stored = database.readConversationPage(agent.id, threadId, { type: "latest" }, 100).messages;
  report.shownStored = stored.flatMap((message) => checked(message.text) ?? []);
  assert.deepEqual(report.shownStored, SHOWN_ORDER, "The stored page shows the answer under the question.");
  const remote = sortConversationMessages(
    stored
      .filter((message) => message.itemType !== AGENT_WELCOME_ITEM_TYPE)
      .map(({ steered: _steered, ...message }) => message),
  );
  report.shownRemoteSort = remote.flatMap((message) => checked(message.text) ?? []);
  assert.deepEqual(report.shownRemoteSort, SHOWN_ORDER, "A client without the setup message keeps the same order.");
  report.passed = true;
} catch (error) {
  report.standInEvents ??= standInEvents();
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
