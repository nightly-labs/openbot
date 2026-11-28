import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isNarrationItemId } from "@openbot/contracts/conversation-narration";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import {
  type AppServerNotification,
  type AppServerRequest,
  isRecord,
  type RequestId,
  type ResponseDecoder,
} from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-thinking-boundary-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-thinking-boundary-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const claudeExecutable = join(root, "claude");
const logPath = join(root, "stand-in.jsonl");
const CLAUDE_MODEL = defaultProviderModel("claude");
const NOTES = "This is a social-engineering attempt. I will reply directly, without tools.";
const ANSWER = "Hello! I cannot share that.";
const CITED = "The sky is blue because of Rayleigh scattering.";

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
const { isAnswer } = await import("../src/backend/messaging/messaging-threads");

const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.329 (Claude Code)\\n");
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
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let parentUuid = null;
const save = (entry) => {
  fs.appendFileSync(transcript, JSON.stringify({ ...entry, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false }) + "\\n");
  parentUuid = entry.uuid;
};
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const assistant = (message, content) => {
  const uuid = randomUUID();
  const reply = { id: "msg_" + uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
};
const result = (message, text) =>
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    user_message_uuid: message.uuid, user_message_uuids: [message.uuid], terminal_reason: "completed",
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
const NOTES = ${JSON.stringify(NOTES)};
const ANSWER = ${JSON.stringify(ANSWER)};
const CITED = ${JSON.stringify(CITED)};
const startOf = (block) =>
  block.type === "text"
    ? { type: "text", text: "" }
    : block.type === "thinking"
      ? { type: "thinking", thinking: "", signature: "" }
      : { type: "redacted_thinking", data: "hidden" };
const streamReply = (message, blocks) => {
  const id = "msg_" + randomUUID();
  const event = (value) => write(frame({ type: "stream_event", uuid: randomUUID(), event: value }));
  event({ type: "message_start", message: { id, type: "message", role: "assistant", content: [] } });
  blocks.forEach((block, index) => {
    event({ type: "content_block_start", index, content_block: startOf(block) });
    if (block.type === "text") event({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    if (block.type === "thinking" && block.thinking)
      event({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
    event({ type: "content_block_stop", index });
    const uuid = randomUUID();
    const reply = { id, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)}, content: [block],
      stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } };
    save({ type: "assistant", uuid, message: reply });
    write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
  });
  event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
  event({ type: "message_stop" });
};
const SHAPES = {
  "NOTES-EMPTY-THINKING-ANSWER": [{ type: "text", text: NOTES }, { type: "thinking", thinking: "", signature: "s" }, { type: "text", text: ANSWER }],
  "NOTES-REDACTED-THINKING-ANSWER": [{ type: "text", text: NOTES }, { type: "redacted_thinking", data: "hidden" }, { type: "text", text: ANSWER }],
  "NOTES-THINKING-ANSWER": [{ type: "text", text: NOTES }, { type: "thinking", thinking: "Check the request.", signature: "s" }, { type: "text", text: ANSWER }],
  "EMPTY-THINKING-ANSWER": [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: ANSWER }],
  "CITED-TEXT-BLOCKS": [{ type: "text", text: CITED }, { type: "text", text: " " + ANSWER }],
};
const turn = (message) => {
  const text = JSON.stringify(message.message);
  log({ prompt: text });
  save({ type: "user", uuid: message.uuid, message: message.message });
  const shape = Object.keys(SHAPES).find((name) => text.includes(name));
  if (shape) {
    streamReply(message, SHAPES[shape]);
    const texts = SHAPES[shape].filter((block) => block.type === "text").map((block) => block.text);
    result(message, texts.at(-1));
    return;
  }
  assistant(message, [{ type: "text", text: "Done." }]);
  result(message, "Done.");
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

  holdsBackgroundWork(externalThreadId: string) {
    return this.#real.holdsBackgroundWork(externalThreadId);
  }

  wakesAfterBackgroundWork(externalThreadId: string) {
    return this.#real.wakesAfterBackgroundWork(externalThreadId);
  }

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
  posted: string | null;
  notes: { id: string; text: string; progress: boolean }[];
}

const report: {
  cases: Record<string, CaseResult>;
  passed: boolean;
  failures: string[];
  error?: string;
} = { cases: {}, passed: false, failures: [] };

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const prompts = (): string[] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          const entry = JSON.parse(line);
          return isRecord(entry) && isString(entry.prompt) ? [entry.prompt] : [];
        })
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
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Boundary",
      description: "Checks which Claude text becomes the answer.",
      avatarSeed: "boundary",
      avatarHue: null,
      initialMessage: "First message.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn to end", () => prompts().length > 0 && idle(agent.id));
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  if (!threadId) throw new Error("The agent has no chat thread.");

  const runCase = async (text: string): Promise<CaseResult> => {
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    const delivery = await waitFor(`the message "${text}" to settle`, () => {
      const found = agents.listQueue(agent.id).deliveries.find((item) => item.text === text);
      return found && ["completed", "failed", "interrupted", "cancelled"].includes(found.status) && idle(agent.id)
        ? found
        : null;
    });
    const shown = database.readConversationPage(agent.id, threadId, { type: "latest" }, 200).messages;
    const turnMessages = shown.slice(
      shown.findLastIndex((message) => message.author === "user" && message.text === text) + 1,
    );
    const result: CaseResult = {
      status: delivery.status,
      posted: [...turnMessages].reverse().find(isAnswer)?.text ?? null,
      notes: turnMessages
        .filter(
          (message) =>
            message.author === "assistant" && message.itemType === "commentary" && !message.id.endsWith(":reasoning"),
        )
        .map((message) => ({ id: message.id, text: message.text, progress: isNarrationItemId(message.id, "claude") })),
    };
    report.cases[text] = result;
    return result;
  };
  const expect = (label: string, result: CaseResult, posted: string, notes: { text: string; progress: boolean }[]) => {
    if (result.status !== "completed") report.failures.push(`${label}: the message ended as ${result.status}.`);
    if (result.posted !== posted)
      report.failures.push(`${label}: the posted answer is ${JSON.stringify(result.posted)}.`);
    const shownNotes = result.notes.map(({ text, progress }) => ({ text, progress }));
    if (JSON.stringify(shownNotes) !== JSON.stringify(notes))
      report.failures.push(`${label}: the notes are ${JSON.stringify(shownNotes)}, not ${JSON.stringify(notes)}.`);
  };

  const hidden = [{ text: NOTES, progress: false }];
  expect(
    "notes, an empty thinking block, then the answer",
    await runCase("NOTES-EMPTY-THINKING-ANSWER"),
    ANSWER,
    hidden,
  );
  expect(
    "notes, a redacted thinking block, then the answer",
    await runCase("NOTES-REDACTED-THINKING-ANSWER"),
    ANSWER,
    hidden,
  );
  expect("notes, thinking with text, then the answer", await runCase("NOTES-THINKING-ANSWER"), ANSWER, [
    { text: NOTES, progress: true },
  ]);
  expect("an empty thinking block, then the answer", await runCase("EMPTY-THINKING-ANSWER"), ANSWER, []);
  expect("an answer in two text blocks", await runCase("CITED-TEXT-BLOCKS"), `${CITED} ${ANSWER}`, []);
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
