import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentContextState, defaultProviderModel } from "@openbot/contracts/ipc";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-cache-expiry-compaction-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-cache-expiry-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const claudeConfig = join(home, ".claude");
const projectsDir = join(claudeConfig, "projects", "stand-in");
const claudeExecutable = join(root, "claude");
const logPath = join(root, "stand-in.jsonl");
const CLAUDE_MODEL = defaultProviderModel("claude");
const DELAY_MS = 1_500;
const QUIET_WAIT_MS = DELAY_MS * 3;
const LARGE_TOKENS = 611_000;
const SMALL_TOKENS = 50_000;
const COMPACTED_TOKENS = 19_400;

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
let contextTokens = ${LARGE_TOKENS};
const save = (entry) => {
  fs.appendFileSync(transcript, JSON.stringify({ ...entry, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false }) + "\\n");
  parentUuid = entry.uuid;
};
const frame = (message) => ({ ...message, parent_tool_use_id: null, session_id: sessionId });
const result = (message, text) =>
  write(frame({ type: "result", subtype: "success", is_error: false, result: text, uuid: randomUUID(),
    user_message_uuid: message.uuid, user_message_uuids: [message.uuid], terminal_reason: "completed",
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] }));
const compact = (message) => {
  write(frame({ type: "system", subtype: "status", status: "compacting", uuid: randomUUID() }));
  write(frame({ type: "system", subtype: "compact_boundary", uuid: randomUUID(),
    compact_metadata: { trigger: "manual", pre_tokens: contextTokens } }));
  contextTokens = ${COMPACTED_TOKENS};
  write(frame({ type: "system", subtype: "status", status: null, compact_result: "success", uuid: randomUUID() }));
  result(message, "Compacted.");
};
const turn = (message) => {
  const text = typeof message.message.content === "string" ? message.message.content : JSON.stringify(message.message);
  log({ prompt: text });
  if (text === "/compact") {
    compact(message);
    return;
  }
  save({ type: "user", uuid: message.uuid, message: message.message });
  contextTokens = text.includes("SMALL") ? ${SMALL_TOKENS} : ${LARGE_TOKENS};
  const shortCache = text.includes("SHORT-CACHE");
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: shortCache ? 1000 : 0, ephemeral_1h_input_tokens: shortCache ? 0 : 1000 } };
  const uuid = randomUUID();
  const reply = { id: "msg_" + uuid, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage };
  save({ type: "assistant", uuid, message: reply });
  write(frame({ type: "assistant", uuid, message: reply, user_message_uuid: message.uuid }));
  result(message, "Done.");
};
const controlResponse = (request) =>
  request.subtype === "get_context_usage"
    ? { totalTokens: contextTokens, rawMaxTokens: 1000000, categories: [] }
    : {};
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
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id,
        response: controlResponse(message.request ?? {}) } });
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
  readonly compactsOnDemand = true;
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

  promptCacheTtlMs(externalThreadId: string) {
    return this.#real.promptCacheTtlMs(externalThreadId);
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
  cases: {
    large?: {
      compaction: NonNullable<AgentContextState["compaction"]>;
      compactPrompts: number;
      shownBefore: number;
      shown: number;
    };
    small?: { compactPrompts: number };
    switchedOff?: { compactPrompts: number };
    fiveMinutes?: { compactPrompts: number };
    cancelled?: { compactPrompts: number };
    errors?: string[];
  };
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
const compactions = () => prompts().filter((prompt) => prompt === "/compact").length;

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
let compactionSwitch = true;
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
  cacheExpiryCompactionDelayMs: DELAY_MS,
  cacheExpiryCompaction: () => compactionSwitch,
});
const errors: { agentId: string | null; message: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error") errors.push({ agentId: event.agentId ?? null, message: event.message });
});
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
const contextState = (agentId: string): AgentContextState | undefined =>
  agents.getRuntimeSnapshot().contextStates?.find((state) => state.agentId === agentId);
const quietPeriod = () => new Promise((done) => setTimeout(done, QUIET_WAIT_MS));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Cache",
      description: "Checks the compaction before the prompt cache expires.",
      avatarSeed: "cache",
      avatarHue: null,
      initialMessage: "First message.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn to end", () => prompts().length > 0 && idle(agent.id));
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  if (!threadId) throw new Error("The agent has no chat thread.");
  const shownBefore = database.readConversationPage(agent.id, threadId, { type: "latest" }, 200).messages.length;

  const compacted = await waitFor("the compaction before the cache expires", () => {
    const compaction = contextState(agent.id)?.compaction;
    return compaction?.status === "completed" && compaction.afterTokens !== undefined ? compaction : null;
  });
  const shownAfter = database.readConversationPage(agent.id, threadId, { type: "latest" }, 200).messages;
  report.cases.large = { compaction: compacted, compactPrompts: compactions(), shownBefore, shown: shownAfter.length };
  if (compacted.reason !== "cacheExpiry") report.failures.push(`The compaction reason is ${compacted.reason}.`);
  if (compacted.beforeTokens !== LARGE_TOKENS)
    report.failures.push(`The compaction started at ${compacted.beforeTokens} tokens, not ${LARGE_TOKENS}.`);
  if (compacted.afterTokens !== COMPACTED_TOKENS)
    report.failures.push(`The compaction ended at ${compacted.afterTokens} tokens, not ${COMPACTED_TOKENS}.`);
  if (compactions() !== 1) report.failures.push(`Claude got ${compactions()} compaction prompts, not 1.`);
  if (shownAfter.length !== shownBefore)
    report.failures.push(`The chat shows ${shownAfter.length - shownBefore} new messages after the compaction.`);
  if (shownAfter.some((message) => message.text.includes("/compact") || message.text.includes("Compacted.")))
    report.failures.push("The chat shows the compaction command or its result.");

  await quietPeriod();
  if (compactions() !== 1) report.failures.push("The compaction ran again with no new turn.");

  const runTurn = async (text: string) => {
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    await waitFor(`the message "${text}" to end`, () => {
      const found = agents.listQueue(agent.id).deliveries.find((item) => item.text === text);
      return found && found.status === "completed" && idle(agent.id);
    });
  };

  await runTurn("SMALL context.");
  await quietPeriod();
  report.cases.small = { compactPrompts: compactions() };
  if (compactions() !== 1) report.failures.push("A context under 200K tokens was compacted.");

  await runTurn("Large context with the SHORT-CACHE of 5 minutes.");
  await quietPeriod();
  report.cases.fiveMinutes = { compactPrompts: compactions() };
  if (compactions() !== 1) report.failures.push("A thread with the 5 minute cache was compacted.");

  await runTurn("Large context again.");
  await runTurn("Next message before the cache time ends.");
  report.cases.cancelled = { compactPrompts: compactions() };
  if (compactions() !== 1) report.failures.push("A new turn did not cancel the armed compaction.");
  await waitFor("the second compaction", () => compactions() === 2);

  compactionSwitch = false;
  await runTurn("Large context with the switch off.");
  await quietPeriod();
  compactionSwitch = true;
  await runTurn("Large context, then the switch goes off before the timer.");
  compactionSwitch = false;
  await quietPeriod();
  report.cases.switchedOff = { compactPrompts: compactions() };
  if (compactions() !== 2) report.failures.push("A thread was compacted while the setting was off.");

  const agentErrors = errors.filter((error) => error.agentId === agent.id).map((error) => error.message);
  report.cases.errors = agentErrors;
  if (agentErrors.length > 0) report.failures.push(`Errors: ${JSON.stringify(agentErrors)}.`);
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
