// Checks that Claude's thinking keeps its words whole while it streams. Runs the real agent service on
// a temporary profile. Claude is the real `ClaudeAgentClient`, which the Claude Agent SDK connects to
// a stand-in `claude` executable. Like the real CLI, the stand-in gives every stream event a uuid of
// its own, streams one thinking block in several deltas, and repeats each block as a complete message.
// The turn has three thinking blocks over two requests, narration before a tool call, narration that a
// thinking block closes, and an answer. Before this change, each delta of a block started a new line,
// so the stored and the live thinking split words such as "s\num".
// `bun run test:claude-thinking-stream`. Writes .openbot-build/claude-thinking-stream-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  type RequestId,
  type ResponseDecoder,
} from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-thinking-stream-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-thinking-stream-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");

/** The requests of the turn: each block, and the deltas that the stand-in streams it in. */
const REQUESTS = [
  [
    { type: "thinking", chunks: ["The user wants the s", "um of 2 and 3. I sh", "ould read the file first."] },
    { type: "text", chunks: ["Let me read ", "the file."] },
    { type: "tool_use", id: "toolu_read_1", name: "Read", input: { file_path: "/tmp/sum.txt" } },
  ],
  [
    { type: "thinking", chunks: ["The file ", "says 5."] },
    { type: "text", chunks: ["Checking ", "the result."] },
    { type: "thinking", chunks: ["That is ", "the answer."] },
    { type: "text", chunks: ["The sum ", "is 5."] },
  ],
];
const EXPECTED_THINKING = [
  "The user wants the sum of 2 and 3. I should read the file first.",
  "The file says 5.",
  "That is the answer.",
].join("\n");
const EXPECTED_NARRATION = ["Let me read the file.", "Checking the result."];
const EXPECTED_ANSWER = "The sum is 5.";

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end.
const STAND_IN_CLAUDE = `#!/usr/bin/env bun
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
const requests = ${JSON.stringify(REQUESTS)};
const model = ${JSON.stringify(CLAUDE_MODEL)};
const usage = { input_tokens: 10, output_tokens: 20 };
// Like the real CLI, every line has a uuid of its own, also each stream event of one block.
const write = (message) => process.stdout.write(JSON.stringify({ ...message, session_id: sessionId, uuid: randomUUID() }) + "\\n");
const stream = (event) => write({ type: "stream_event", event, parent_tool_use_id: null });
const whole = (block) =>
  block.type === "thinking" ? { type: "thinking", thinking: block.chunks.join(""), signature: "signature" }
  : block.type === "text" ? { type: "text", text: block.chunks.join("") }
  : { type: "tool_use", id: block.id, name: block.name, input: block.input };
let messages = 0;
const turn = () => {
  for (const blocks of requests) {
    const id = "msg_" + process.pid + "_" + (++messages);
    stream({ type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], usage } });
    blocks.forEach((block, index) => {
      const start = block.type === "thinking" ? { type: "thinking", thinking: "", signature: "" }
        : block.type === "text" ? { type: "text", text: "" }
        : { type: "tool_use", id: block.id, name: block.name, input: {} };
      stream({ type: "content_block_start", index, content_block: start });
      for (const chunk of block.chunks ?? []) {
        const delta = block.type === "thinking" ? { type: "thinking_delta", thinking: chunk } : { type: "text_delta", text: chunk };
        stream({ type: "content_block_delta", index, delta });
      }
      if (block.type === "thinking") stream({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "signature" } });
      stream({ type: "content_block_stop", index });
      // The real CLI sends each finished block as an assistant message of its own.
      write({ type: "assistant", message: { id, type: "message", role: "assistant", model, content: [whole(block)],
        stop_reason: null, usage }, parent_tool_use_id: null });
    });
    stream({ type: "message_delta", delta: { stop_reason: blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn" }, usage });
    stream({ type: "message_stop" });
    for (const block of blocks.filter((block) => block.type === "tool_use"))
      write({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: "5" }] },
        parent_tool_use_id: null });
  }
  write({ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(EXPECTED_ANSWER)},
    duration_ms: 1, duration_api_ms: 1, num_turns: requests.length, total_cost_usd: 0.01,
    usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [] });
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
    else if (message.type === "user") turn();
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

/** The live thinking deltas of each turn, as the chat receives them. */
const liveThinking = new Map<string, string>();

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. Sessions, turns and events go to the real client.
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
    this.#real.on("notification", (notification) => {
      const itemId = getString(notification.params, "itemId");
      const delta = getString(notification.params, "delta");
      if (notification.method === "item/agentMessage/delta" && itemId?.endsWith(":reasoning") && delta !== null)
        liveThinking.set(itemId, (liveThinking.get(itemId) ?? "") + delta);
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
  stored: { thinking: string | null; narration: string[]; answer: string | null };
  live: string | null;
  expected: { thinking: string; narration: string[]; answer: string };
  passed: boolean;
  error?: string;
} = {
  stored: { thinking: null, narration: [], answer: null },
  live: null,
  expected: { thinking: EXPECTED_THINKING, narration: EXPECTED_NARRATION, answer: EXPECTED_ANSWER },
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

/** Waits for a state of the service. */
async function waitFor<T>(
  label: string,
  read: () => Promise<T | null | undefined | false>,
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

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Thinking stream",
      description: "Checks the streamed thinking of a Claude turn.",
      avatarSeed: "thinking-stream",
      avatarHue: null,
      initialMessage: "What is 2 + 3?",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const isAnswer = (message: { author: string; itemType?: string | undefined }) =>
    message.author === "assistant" && message.itemType === "agentMessage";
  const conversation = await waitFor("the turn to store its answer", async () => {
    const snapshot = await runCauseEffect(agents.readConversation(agent.id));
    return snapshot.activeTurnId === null && snapshot.messages.some(isAnswer) && snapshot;
  });
  const reasoning = conversation.messages.find((message) => message.id.endsWith(":reasoning"));
  report.stored.thinking = reasoning?.text ?? null;
  report.stored.narration = conversation.messages
    .filter((message) => message.itemType === "commentary" && message.id.includes(":narration:"))
    .map((message) => message.text);
  report.stored.answer = conversation.messages.find(isAnswer)?.text ?? null;
  report.live = reasoning ? (liveThinking.get(reasoning.id) ?? null) : null;

  assert.equal(report.stored.thinking, EXPECTED_THINKING, "The stored thinking keeps each block whole.");
  assert.equal(report.live, EXPECTED_THINKING, "The live thinking deltas add up to the same text.");
  assert.deepEqual(
    report.stored.narration,
    EXPECTED_NARRATION,
    "A tool call and a thinking block close the narration.",
  );
  assert.equal(report.stored.answer, EXPECTED_ANSWER, "The answer stays the text after the last thinking block.");
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
