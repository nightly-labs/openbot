import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES } from "@openbot/contracts/agent-memory-context";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { isTurnContextBlock } from "../src/backend/agent/developer-instructions";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/essential-memory-budget-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-essential-memory-budget-"));
const home = join(root, "home");
const messageLog = join(root, "claude-messages.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
// Each memory is stored at about 480 characters, so a dozen fill the 8,192 byte essential budget. The text holds
// short "token=a" assignments. The prompt redacts them to "token=[redacted]", which is longer than what was stored,
// so the redacted block no longer fits the budget that the selection check measured on the stored text.
const memoryText = (index: number) => `Fact ${index}: ${"token=a ".repeat(58)}`.trim();

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

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
const resume = option("--resume");
const sessionId = resume ?? option("--session-id") ?? randomUUID();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const turn = (message) => {
  const content = message.message?.content;
  const blocks = typeof content === "string" ? [content]
    : Array.isArray(content) ? content.filter((block) => block.type === "text").map((block) => block.text) : [];
  fs.appendFileSync(${JSON.stringify(messageLog)}, JSON.stringify({ pid: process.pid, resume, sessionId, blocks }) + "\\n");
  const usage = { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 20 };
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant",
    model: ${JSON.stringify(CLAUDE_MODEL)}, content: [{ type: "text", text: "Done." }], stop_reason: null, usage },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  write({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0.01, usage, permission_denials: [] });
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
  readonly #oldRelease: boolean;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo, oldRelease: boolean) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.#oldRelease = oldRelease;
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get turnContext(): boolean {
    return this.#real.turnContext;
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

  releaseThread(externalThreadId: string, resumes?: boolean) {
    return this.#real.releaseThread(externalThreadId, this.#oldRelease ? false : resumes);
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

interface LoggedMessage {
  pid: number;
  resume: string | null;
  sessionId: string;
  blocks: string[];
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

function logged(): LoggedMessage[] {
  try {
    return readFileSync(messageLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const MAX_FIT_MEMORIES = 40;

interface Report {
  model: string;
  budgetBytes: number;
  storedMemories: number;
  storedEssentialBytes: number;
  promptMemories: number;
  promptBlockBytes: number;
  omittedNotice: boolean;
  passed: boolean;
  error?: string;
}

const report: Report = {
  model: CLAUDE_MODEL,
  budgetBytes: AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
  storedMemories: 0,
  storedEssentialBytes: 0,
  promptMemories: 0,
  promptBlockBytes: 0,
  omittedNotice: false,
  passed: false,
};

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });

const userData = join(root, "user-data");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli, false),
});

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Budget",
      description: "Checks the essential memory block against its byte budget.",
      avatarSeed: "budget",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first chat turn to reach Claude", () => logged()[0]);
  // Save memories one by one and mark each essential the way the user does in Settings, until the app refuses.
  for (let index = 0; index < MAX_FIT_MEMORIES; index++) {
    const created = agents.createMemory({ agentId: agent.id, text: memoryText(index) });
    const selection = agents.getMemorySelection(agent.id).selections.find((entry) => entry.memoryId === created.id);
    assert.ok(selection, "the new memory has a selection");
    try {
      agents.setMemoryInclusion({
        agentId: agent.id,
        changes: [{ memoryId: created.id, inclusion: "essential", expectedRevision: selection.revision }],
      });
    } catch {
      break;
    }
  }
  const selected = agents.getMemorySelection(agent.id);
  const essential = selected.selections.filter((entry) => entry.inclusion === "essential");
  report.storedMemories = selected.selections.length;
  report.storedEssentialBytes = selected.usedBytes;
  assert.ok(essential.length > 1, "several memories are essential");
  assert.ok(
    selected.usedBytes <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
    "the selection check keeps the stored essential memories within the budget",
  );
  const before = logged().length;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Read the memories." }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "the message has a delivery");
  await waitFor("the delivery to end", () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  const message = await waitFor("the turn to reach Claude", () => logged()[before]);
  const block = message.blocks.filter(isTurnContextBlock).find((text) => text.startsWith("<openbot_saved_memories"));
  assert.ok(block, "the turn carries a saved-memory block");
  const entries = /<agent_memories count="(\d+)">/u.exec(block);
  report.promptMemories = Number(entries?.[1] ?? -1);
  report.promptBlockBytes = Buffer.byteLength(block, "utf8");
  report.omittedNotice = /did not fit the prompt limit/u.test(block);
  assert.ok(report.promptMemories >= 0, "the block reports how many memories it carries");
  // The check that the stored memories fit must also describe what the model sees. When the prompt keeps fewer
  // essential memories than the user marked, the block has to say so.
  if (report.promptMemories < essential.length)
    assert.ok(
      report.omittedNotice,
      `${essential.length - report.promptMemories} essential memories were left out of the prompt without a notice`,
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
}
