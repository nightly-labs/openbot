import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentBackupModels,
  type AgentEvent,
  type AgentModelId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  defaultProviderModel,
  MODEL_SWITCH_ITEM_TYPES,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/backup-model-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-backup-model-failover-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const turnLog = join(root, "claude-turns.jsonl");
const failingFile = join(root, "failing.json");
const refusedModelsFile = join(root, "refused-models.json");
const claudeExecutable = join(root, "claude");
const codexExecutable = join(root, "codex");
const codexLog = join(root, "codex-turns.jsonl");
const workLog = join(root, "work.jsonl");
const CODEX_MODEL = defaultProviderModel("codex");
const PRIMARY: AgentModelId = defaultProviderModel("claude");
const BACKUP: AgentModelId = PRIMARY === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
const PROVIDER_ERROR =
  'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_e2e"}';
const CONNECTION_ERROR = "API Error: Connection error.";
const REFUSED_MODEL_SWITCH =
  "API error: 429 This request would exceed your account's rate limit. Please try again later \u00b7 model not changed";
const REFUSED_REQUEST =
  'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"This model requires Responses for tool calls; this account only supports Chat Completions"}}';
const MODEL_NOT_OFFERED = `There's an issue with the selected model (${PRIMARY}). It may not exist or you may not have access to it.`;

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
process.env.OPENBOT_CODEX_PATH = codexExecutable;
process.env.CODEX_HOME = join(home, ".codex");
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { CodexAppServerClient } = await import("../src/backend/app-server-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { importProviderHistory } = await import("../src/backend/provider-history-import");

const STAND_IN_CLAUDE = `#!/usr/bin/env node
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
let model = option("--model");
const project = require("node:path").join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
fs.mkdirSync(project, { recursive: true });
const transcript = require("node:path").join(project, sessionId + ".jsonl");
const previous = fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8").trim().split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const recorded = new Set(previous.map((row) => row.uuid));
let parentUuid = previous.at(-1)?.uuid ?? null;
const record = (message) => {
  if (recorded.has(message.uuid)) return;
  const row = { ...message, parentUuid, sessionId, timestamp: new Date().toISOString(), isSidechain: false };
  fs.appendFileSync(transcript, JSON.stringify(row) + "\\n");
  recorded.add(row.uuid);
  parentUuid = row.uuid;
};
const write = (message) => {
  if (message.type === "assistant") record(message);
  process.stdout.write(JSON.stringify(message) + "\\n");
};
const result = (fields) =>
  write({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), duration_ms: 1,
    duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    permission_denials: [], modelUsage: {}, ...fields });
const assistant = (text) =>
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
const turn = (message) => {
  record(message);
  const failing = JSON.parse(fs.readFileSync(${JSON.stringify(failingFile)}, "utf8"));
  const fails = failing.includes(model);
  const input = JSON.stringify(message);
  const drops = input.includes("drop-then-fail");
  const acts = drops || input.includes("act-then-fail");
  fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: fails, input, pid: process.pid }) + "\\n");
  if (input.includes("usage-relay") && model === ${JSON.stringify(PRIMARY)}) {
    const startHelper = (description) => {
      const callId = "toolu_" + randomUUID().replaceAll("-", "");
      write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
        content: [{ type: "tool_use", id: callId, name: "Agent", input: { description, prompt: "Research.", run_in_background: true } }],
        stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
      write({ type: "system", subtype: "task_started", task_id: "task-" + callId, tool_use_id: callId, description,
        session_id: sessionId, uuid: randomUUID() });
      return callId;
    };
    const finishHelper = (callId, summary) =>
      write({ type: "system", subtype: "task_notification", task_id: "task-" + callId, tool_use_id: callId,
        status: "completed", summary, session_id: sessionId, uuid: randomUUID() });
    const first = startHelper("Background research");
    assistant("A helper works in the background.");
    result({ is_error: false, result: "A helper works in the background." });
    setTimeout(() => {
      finishHelper(first, "Found three sources.");
      fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: false, input: "first report", pid: process.pid }) + "\\n");
      const second = startHelper("Source check");
      assistant("A second helper checks the sources.");
      result({ is_error: false, result: "A second helper checks the sources." });
      setTimeout(() => {
        finishHelper(second, "Two sources hold.");
        fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: true, input: "second report", pid: process.pid }) + "\\n");
        const limit = "You've hit your limit. Try again later.";
        write({ type: "assistant", error: "rate_limit", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
          content: [{ type: "text", text: limit }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
          parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
        result({ is_error: true, result: limit });
      }, 200);
    }, 200);
    return;
  }
  if ((input.includes("usage-background") || input.includes("usage-report-read") || input.includes("usage-subagent")) && model === ${JSON.stringify(PRIMARY)}) {
    const callId = "toolu_" + randomUUID().replaceAll("-", "");
    write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
      content: [{ type: "tool_use", id: callId, name: "Agent", input: { description: "Background research", prompt: "Research.", run_in_background: true } }],
      stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    assistant("A helper works in the background.");
    result({ is_error: false, result: "A helper works in the background." });
    setTimeout(() => {
      const limit = "You've hit your limit. Try again later.";
      if (input.includes("usage-subagent")) {
        process.stdout.write(JSON.stringify({ type: "assistant", error: "rate_limit", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
          content: [{ type: "text", text: "You've hit your 5-hour limit · resets 7:50pm" }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
          parent_tool_use_id: callId, session_id: sessionId, uuid: randomUUID() }) + "\\n");
        process.stdout.write(JSON.stringify({ type: "system", subtype: "task_notification", task_id: "task-" + callId, tool_use_id: callId,
          status: "failed", summary: "You've hit your 5-hour limit · resets 7:50pm", session_id: sessionId, uuid: randomUUID() }) + "\\n");
        fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: true, input: "background report", pid: process.pid }) + "\\n");
        assistant("");
        write({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600 },
          session_id: sessionId, uuid: randomUUID() });
        result({ is_error: false, result: "" });
        return;
      }
      process.stdout.write(JSON.stringify({ type: "system", subtype: "task_notification", task_id: "task-" + callId, tool_use_id: callId,
        status: "completed", summary: "Found three sources.", session_id: sessionId, uuid: randomUUID() }) + "\\n");
      fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: true, input: "background report", pid: process.pid }) + "\\n");
      const refuse = () => {
        write({ type: "assistant", error: "rate_limit", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
          content: [{ type: "text", text: limit }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
          parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
        result({ is_error: true, result: limit });
      };
      if (!input.includes("usage-report-read")) return refuse();
      assistant("Read the report.");
      result({ is_error: false, result: "Read the report." });
      setTimeout(refuse, 200);
    }, 200);
    return;
  }
  if ((input.includes("usage-work") || input.includes("usage-chain") || input.includes("usage-exhausted")) &&
      (model === ${JSON.stringify(PRIMARY)} || input.includes("usage-exhausted"))) {
    if (!input.includes("usage-chain-empty")) assistant("Checkpoint saved. Only the final step remains.");
    result({ is_error: true, result: "You've hit your limit. Try again later." });
    return;
  }
  if (input.includes("refused-key") && model === ${JSON.stringify(PRIMARY)}) {
    const refused = "Invalid API key · Please run /login";
    write({ type: "assistant", error: "authentication_failed", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
      content: [{ type: "text", text: refused }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
      parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    result({ is_error: true, result: refused });
    return;
  }
  if (input.includes("model-not-offered") && model === ${JSON.stringify(PRIMARY)}) {
    write({ type: "assistant", error: "model_not_found", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
      content: [{ type: "text", text: ${JSON.stringify(MODEL_NOT_OFFERED)} }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
      parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    result({ is_error: true, result: ${JSON.stringify(MODEL_NOT_OFFERED)} });
    return;
  }
  if (input.includes("refused-request") && model === ${JSON.stringify(PRIMARY)}) {
    if (input.includes("refused-request-after-work")) assistant("Partial answer.");
    result({ is_error: true, result: ${JSON.stringify(REFUSED_REQUEST)} });
    return;
  }
  if (fails) {
    if (acts) assistant("Partial answer.");
    result({ is_error: true, result: drops ? ${JSON.stringify(CONNECTION_ERROR)} : ${JSON.stringify(PROVIDER_ERROR)} });
    return;
  }
  const caseId = /case:([a-z-]+)/.exec(input)?.[1];
  if (caseId) {
    const saved = fs.existsSync(${JSON.stringify(workLog)}) && fs.readFileSync(${JSON.stringify(workLog)}, "utf8").split("\\n").filter(Boolean).some((line) => { const step = JSON.parse(line); return step.caseId === caseId && step.step === "checkpoint"; });
    const continued = input.includes("Continue the unfinished task") &&
      (input.includes("checkpoint-result=" + caseId) || (input.includes("Full tool results are unavailable") && input.includes("save-checkpoint " + caseId) && saved));
    fs.appendFileSync(${JSON.stringify(workLog)}, JSON.stringify({ caseId, step: continued ? "final" : "repeated-checkpoint" }) + "\\n");
  }
  assistant("Done.");
  result({ is_error: false, result: "Done." });
};
const taken = new Set();
const saved = new Set(previous.map((row) => row.uuid));
let heldOnce = false;
const lifecycle = (uuid, state) =>
  process.stdout.write(JSON.stringify({ type: "command_lifecycle", command_uuid: uuid, state, uuid: randomUUID(), session_id: sessionId }) + "\\n");
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
      const refusedModels = fs.existsSync(${JSON.stringify(refusedModelsFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(refusedModelsFile)}, "utf8")) : [];
      if (message.request?.subtype === "set_model" && refusedModels.includes(message.request.model)) {
        write({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: ${JSON.stringify(REFUSED_MODEL_SWITCH)} } });
        continue;
      }
      if (message.request?.subtype === "set_model") model = message.request.model ?? model;
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    } else if (message.type === "user" && !taken.has(message.uuid)) {
      taken.add(message.uuid);
      const held = !heldOnce && line.includes("session-holds");
      if (held) heldOnce = true;
      if (held || saved.has(message.uuid) || line.includes("session-skips")) {
        lifecycle(message.uuid, "completed");
        continue;
      }
      lifecycle(message.uuid, "started");
      turn(message);
      lifecycle(message.uuid, "completed");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

const STAND_IN_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
if (process.argv.includes("--version")) { console.log("codex-cli 0.160.1"); process.exit(0); }
const threads = new Map();
const active = new Map();
let reset = false;
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const answer = (request) => {
  const params = request.params ?? {};
  const reply = (result) => write({ id: request.id, result });
  const thread = threads.get(params.threadId) ?? { id: params.threadId, turns: [] };
  switch (request.method) {
    case "initialize": return reply({});
    case "account/read": return reply({ account: { type: "chatgpt", email: "codex@example.com" } });
    case "account/rateLimits/read": return reply({ rateLimits: { limitId: "codex", primary: { usedPercent: reset ? 0 : 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: null }, rateLimitsByLimitId: null });
    case "account/rateLimitResetCredit/consume": reset = true; return reply({ outcome: "reset" });
    case "model/list": return reply({ data: [{ model: ${JSON.stringify(CODEX_MODEL)}, displayName: "Codex" }] });
    case "plugin/list": return reply({ marketplaces: [] });
    case "config/read": return reply(config);
    case "config/batchWrite": return reply({});
    case "thread/start": {
      const thread = { id: randomUUID(), turns: [] };
      threads.set(thread.id, thread);
      return reply({ thread });
    }
    case "thread/resume":
    case "thread/read": return reply({ thread });
    case "thread/unsubscribe": return reply({ status: "Unsubscribed" });
    case "thread/turns/list":
      if (thread.turns.some((turn) => turn.input?.includes("usage-slow-history"))) return;
      if (thread.turns.some((turn) => turn.input?.includes("usage-unreadable"))) return write({ id: request.id, error: { code: -32002, message: "History could not be read." } });
      return reply({ data: thread.turns.toReversed(), nextCursor: null });
    case "thread/items/list": return reply({ data: (thread.turns.find((turn) => turn.id === params.turnId)?.items ?? []).map((item) => ({ turnId: params.turnId, item })), nextCursor: null });
    case "turn/start": {
      const turn = { id: randomUUID(), status: "inProgress", items: [] };
      thread.turns.push(turn);
      const input = JSON.stringify(params.input);
      const current = input.split("--- current message ---").at(-1);
      turn.input = current;
      const limited = current.includes("usage-") && !reset;
      const caseId = /case:([a-z-]+)/.exec(current)?.[1] ?? "no-case";
      fs.appendFileSync(${JSON.stringify(codexLog)}, JSON.stringify({ model: params.model, threadId: thread.id, turnId: turn.id, input, limited }) + "\\n");
      reply({ turn });
      write({ method: "turn/started", params: { threadId: thread.id, turn: { id: turn.id } } });
      const item = (item) => { turn.items.push(item); write({ method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } }); };
      const finish = (status) => { turn.status = status; write({ method: "turn/completed", params: { threadId: thread.id, turn } }); };
      active.set(turn.id, finish);
      setImmediate(() => {
        if (limited && !current.includes("usage-empty")) {
          fs.appendFileSync(${JSON.stringify(workLog)}, JSON.stringify({ caseId, step: "checkpoint" }) + "\\n");
          item({ type: "commandExecution", id: randomUUID(), command: "save-checkpoint " + caseId, cwd: params.cwd, status: "completed", exitCode: 0, aggregatedOutput: "checkpoint-result=" + caseId });
          if (!current.includes("usage-tool-only")) item({ type: "agentMessage", id: randomUUID(), phase: "commentary", text: "Checkpoint saved for " + caseId + ". Only the final step remains." });
        }
        if (current.includes("usage-wait")) return;
        if (current.includes("capacity-wait")) {
          const error = { message: "Reconnecting... 2/5", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } }, additionalDetails: "Selected model is at capacity. Please try a different model." };
          return write({ method: "error", params: { threadId: thread.id, turnId: turn.id, error, willRetry: true } });
        }
        if (limited) {
          const error = current.includes("usage-spent")
            ? { message: "Your credit balance is too low to continue.", codexErrorInfo: "usageLimitExceeded" }
            : { message: "You've hit your usage limit. Try again later.", codexErrorInfo: "usageLimitExceeded" };
          turn.error = error;
          write({ method: "error", params: { threadId: thread.id, turnId: turn.id, error, willRetry: false } });
          finish("failed");
        } else {
          if (caseId !== "no-case") {
            const continued = input.includes("Continue the unfinished task") && input.includes("checkpoint-result=" + caseId);
            fs.appendFileSync(${JSON.stringify(workLog)}, JSON.stringify({ caseId, step: continued ? "final" : "repeated-checkpoint" }) + "\\n");
          }
          item({ type: "agentMessage", id: randomUUID(), phase: "final_answer", text: "Done." });
          finish("completed");
        }
        active.delete(turn.id);
      });
      return;
    }
    case "turn/interrupt": reply({}); active.get(params.turnId)?.("interrupted"); active.delete(params.turnId); return;
    default: return write({ id: request.id, error: { code: -32601, message: "Method not found: " + request.method } });
  }
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.id !== undefined && request.method) answer(request);
  }
});
process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); else throw error; });
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
  lastThread: string | null = null;
  readonly toolAnswers = new Map<RequestId, unknown>();
  readonly #started = new Set<string>();

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (notification.method === "turn/started" && isDynamicRecord(notification.params)) {
        const threadId = notification.params.threadId;
        if (typeof threadId === "string") this.lastThread = threadId;
      }
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
        return providerSync(() =>
          decoder({
            data: [
              { model: PRIMARY, displayName: "Primary" },
              { model: BACKUP, displayName: "Backup" },
            ],
          }),
        );
      case "turn/start": {
        const messageId = isDynamicRecord(params) ? params.clientUserMessageId : undefined;
        const again = typeof messageId === "string" && this.#started.has(messageId);
        if (typeof messageId === "string") this.#started.add(messageId);
        if (!again || !closeBeforeRunAgain) return this.#real.request(method, params, decoder, timeoutMs);
        return this.#real
          .releaseIdleThreads()
          .pipe(Effect.andThen(this.#real.request(method, params, decoder, timeoutMs)));
      }
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, result);
    else this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, { error });
    else this.#real.respondError(id, error);
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const report: {
  primary: string;
  backup: string;
  checks: Check[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = {
  primary: PRIMARY,
  backup: BACKUP,
  checks: [],
  passed: false,
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
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turns(): { model: string; failed: boolean; input: string; pid: number }[] {
  try {
    return readFileSync(turnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const failing = (models: string[]) => writeFileSync(failingFile, JSON.stringify(models));
const refuseModelSwitch = (models: string[]) => writeFileSync(refusedModelsFile, JSON.stringify(models));

let closeBeforeRunAgain = false;

function readLog<T>(path: string): T[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

interface CodexTurn {
  model: string;
  threadId: string;
  turnId: string;
  input: string;
  limited: boolean;
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
await writeFile(codexExecutable, STAND_IN_CODEX, { mode: 0o755 });
failing([]);
const database = new OpenBotDatabase(userData);
const clients: ClaudeStandIn[] = [];
const events: AgentEvent[] = [];

function startService() {
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude" && provider !== "codex"),
    clientFactory: (provider, cli) => {
      if (provider === "codex") return new CodexAppServerClient(cli.executable, 30000);
      const client = new ClaudeStandIn(cli);
      clients.push(client);
      return client;
    },
  });
  service.on("event", (event) => events.push(event));
  return { store, mailbox, service };
}

let { store, mailbox, service } = startService();

function agentOf(agentId: string) {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Agent ${agentId} exists.`);
  return agent;
}

function errorsFor(agentId: string, since: number) {
  return events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

async function send(agentId: string, text: string, sourcePaths?: string[]) {
  const attachments = await runCauseEffect(mailbox.prepareAttachments(sourcePaths ?? []));
  const receipt = await runCauseEffect(
    service.sendMessage({ agentId, text, attachmentDraftIds: attachments.map((attachment) => attachment.id) }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`"${text}" to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" ? value : null;
  });
  return { deliveryId, status, error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null };
}

function modelName(model: string): string {
  return service.listModels().find((option) => option.provider === "claude" && option.id === model)?.name ?? model;
}

async function markers(agentId: string, itemType: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  return snapshot.messages.filter((message) => message.itemType === itemType).map((message) => message.text);
}

let toolCalls = 0;
async function callTool(tool: string, args: unknown) {
  const client = clients.at(-1);
  assert.ok(client, "The service made a Claude client.");
  const thread = client.lastThread;
  assert.ok(thread, "A turn ran.");
  const id = `e2e-tool-${++toolCalls}`;
  client.emit("request", {
    id,
    method: "item/tool/call",
    params: { threadId: thread, turnId: "e2e-turn", callId: id, namespace: "openbot", tool, arguments: args },
  });
  const answer = await waitFor(`${tool} to answer`, () => client.toolAnswers.get(id));
  assert.ok(isDynamicRecord(answer) && Array.isArray(answer.contentItems), `${tool} answers with content.`);
  const item = answer.contentItems[0];
  assert.ok(isDynamicRecord(item) && typeof item.text === "string", `${tool} answers with text.`);
  return { success: answer.success === true, text: item.text };
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

async function restart() {
  await runCauseEffect(service.stop());
  ({ store, mailbox, service } = startService());
  await runCauseEffect(service.initialize());
}

async function createCodex(name: string, backupModels?: AgentBackupModels) {
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks usage-limit continuation.",
      avatarSeed: randomUUID(),
      avatarHue: null,
      provider: "codex",
      model: CODEX_MODEL,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the initial Codex turn to end", () =>
    service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
  );
  if (backupModels) await runCauseEffect(service.updateAgent({ agentId: agent.id, backupModels }));
  return agentOf(agent.id);
}

const automaticBackups: AgentBackupModels = {
  automatic: true,
  order: [
    { provider: "claude", model: PRIMARY },
    { provider: "claude", model: BACKUP },
  ],
};

async function verifyHistoryKeepsRequests(agentId: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  const threadId = snapshot.threadId;
  assert.ok(threadId);
  const users = () =>
    database
      .readConversation(agentId, threadId)
      .messages.filter((message) => message.author === "user")
      .map((message) => ({ id: message.id, text: message.text }))
      .sort((left, right) => left.id.localeCompare(right.id));
  const before = users();
  const client = clients.at(-1);
  const session = database.listProviderSessions(threadId).find((session) => session.state === "active");
  assert.ok(client && session);
  const imported = await runCauseEffect(
    importProviderHistory({
      database,
      readHistory: client.readHistory.bind(client),
      sessionId: session.id,
      provider: "claude",
      externalSessionId: session.externalSessionId,
      agentId,
      publicThreadId: threadId,
      cwd: agentOf(agentId).workspacePath,
      findDelivery: (id) => mailbox.deliveryForProviderMessage(agentId, id),
      findMessageDelivery: (id) => mailbox.deliveryForMessage(id, agentId),
      quietRoutineDelivery: () => false,
    }),
  );
  assert.ok(
    imported.turns > 0 || database.providerHistoryImport(session.id)?.state === "complete",
    "The provider's saved transcript was read and imported.",
  );
  assert.deepEqual(users(), before, "History import keeps one user request after independent continuation turn IDs.");
  const texts = users().map((message) => message.text);
  assert.equal(new Set(texts).size, texts.length, "History import adds no second copy of a user request.");
}

try {
  await runCauseEffect(service.initialize());
  const create = (name: string) =>
    runCauseEffect(
      service.createAgent({
        name,
        description: "Checks backup models.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "claude",
        model: PRIMARY,
      }),
    );
  const mover = await create("Mover");
  const stayer = await create("Stayer");
  await waitFor(
    "the first turns to end",
    () =>
      turns().length >= 2 &&
      !service
        .listQueue(mover.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)) &&
      !service
        .listQueue(stayer.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
  );
  await runCauseEffect(
    service.updateAgent({
      agentId: mover.id,
      backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
    }),
  );
  failing([PRIMARY]);

  await check("an agent with no backup models fails as before", async () => {
    const since = events.length;
    const outcome = await send(stayer.id, "work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(stayer.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(stayer.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("a provider error moves the agent to its backup model", async () => {
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "work");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, BACKUP, "The agent is on the backup model.");
    assert.equal(agent.usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.equal(agent.usageLimitReturn?.cause, "provider-error", "The return names the provider error.");
    assert.deepEqual(errorsFor(mover.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) })]);
    await verifyHistoryKeepsRequests(mover.id);
    return { ran, notes };
  });

  await check("read_agent shows that a provider error moved the agent", async () => {
    const read = await callTool("read_agent", { agentId: mover.id });
    assert.ok(read.success, read.text);
    const setup = JSON.parse(read.text);
    assert.equal(setup.model, BACKUP, "read_agent shows the backup model.");
    assert.equal(setup.usageLimitReturn?.model, PRIMARY, "read_agent names the model to go back to.");
    assert.equal(setup.usageLimitReturn?.cause, "provider-error", "read_agent names the provider error.");
    return { model: setup.model, usageLimitReturn: setup.usageLimitReturn };
  });

  await check("after a restart the agent goes back to its own model", async () => {
    await runCauseEffect(service.stop());
    failing([]);
    ({ store, mailbox, service } = startService());
    await runCauseEffect(service.initialize());
    const before = turns().length;
    const outcome = await send(mover.id, "again");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "The message runs on the own model.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, PRIMARY, "The agent is back on its own model.");
    assert.equal(agent.usageLimitReturn, undefined, "Nothing is left to go back to.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelReturnedAfterError", { model: modelName(PRIMARY) })]);
    return { notes };
  });

  const withBackup = async (name: string) => {
    const agent = await create(name);
    await waitFor(`the first turn of ${name} to end`, () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    await runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
    return agent;
  };

  await check("a turn that wrote text continues on the backup model", async () => {
    const continuer = await withBackup("Continuer");
    failing([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(continuer.id, "act-then-fail");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    assert.ok(ran[1]?.input.includes("Continue the unfinished task"), "The backup continues the work.");
    assert.equal(agentOf(continuer.id).model, BACKUP, "The agent is on the backup model.");
    assert.deepEqual(errorsFor(continuer.id, since), [], "No error shows for the moved turn.");
    const shown = (await runCauseEffect(service.readConversation(continuer.id))).messages
      .filter((message) => message.text.trim())
      .slice(-4)
      .map((message) => message.text);
    assert.deepEqual(
      shown,
      [
        "act-then-fail",
        "Partial answer.",
        sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) }),
        "Done.",
      ],
      "The chat shows the stopped text, the switch and then the backup's answer.",
    );
    failing([]);
    await restart();
    return { ran: ran.map((turn) => turn.model), shown };
  });

  await check("a request that the model refuses before work moves the agent to its backup model", async () => {
    const refused = await withBackup("Refuser");
    const since = events.length;
    const before = turns().length;
    const outcome = await send(refused.id, "refused-request");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    assert.equal(agentOf(refused.id).model, BACKUP, "The agent is on the backup model.");
    assert.deepEqual(errorsFor(refused.id, since), [], "No error shows for the moved turn.");
    await restart();
    return { ran: ran.map((turn) => turn.model) };
  });

  await check("a model that the account cannot use moves the agent to its backup model", async () => {
    const denied = await withBackup("Denied");
    const since = events.length;
    const before = turns().length;
    const outcome = await send(denied.id, "model-not-offered");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    assert.equal(agentOf(denied.id).model, BACKUP, "The agent is on the backup model.");
    assert.deepEqual(errorsFor(denied.id, since), [], "No error shows for the moved turn.");
    await restart();
    return { ran: ran.map((turn) => turn.model) };
  });

  await check("a model that the account cannot use shows the error with no backup model", async () => {
    const lone = await create("Unbacked");
    await waitFor("the first turn of Unbacked to end", () =>
      service.listQueue(lone.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    const since = events.length;
    const outcome = await send(lone.id, "model-not-offered");
    assert.equal(outcome.status, "failed", "The message fails.");
    assert.equal(agentOf(lone.id).model, PRIMARY, "The agent keeps its model.");
    assert.ok(
      errorsFor(lone.id, since).some((event) => JSON.stringify(event).includes("may not have access")),
      "The provider's reason shows.",
    );
    await restart();
    return { status: outcome.status };
  });

  await check("a model switch that the provider refuses at a limit moves the agent to its backup model", async () => {
    const switcher = await withBackup("Switcher");
    failing([PRIMARY]);
    const moved = await send(switcher.id, "work");
    assert.equal(moved.status, "completed", `The message completes: ${moved.error}`);
    assert.equal(agentOf(switcher.id).model, BACKUP, "The provider error moved the agent to its backup.");
    failing([]);
    refuseModelSwitch([PRIMARY]);
    await runCauseEffect(service.updateAgent({ agentId: switcher.id, provider: "claude", model: PRIMARY }));
    const since = events.length;
    const before = turns().length;
    const results = [];
    for (const text of ["first after the switch", "second after the switch"]) {
      const outcome = await send(switcher.id, text);
      assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
      results.push(outcome);
    }
    const ran = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(ran, [BACKUP, BACKUP], "The backup answers each message.");
    assert.equal(agentOf(switcher.id).model, BACKUP, "The agent is on its backup model.");
    assert.equal(agentOf(switcher.id).usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.deepEqual(errorsFor(switcher.id, since), [], "No error shows for the refused switch.");
    refuseModelSwitch([]);
    await restart();
    return { ran, results };
  });

  await check("a model switch that the provider refuses at a limit shows the error with no backup model", async () => {
    const lone = await create("Lone");
    await waitFor("the first turn of Lone to end", () =>
      service.listQueue(lone.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    refuseModelSwitch([BACKUP]);
    await runCauseEffect(service.updateAgent({ agentId: lone.id, provider: "claude", model: BACKUP }));
    const since = events.length;
    const before = turns().length;
    const outcome = await send(lone.id, "no backup to take it");
    assert.equal(outcome.status, "failed", "The message fails.");
    assert.equal(outcome.error, REFUSED_MODEL_SWITCH, "The provider's reason shows.");
    assert.equal(turns().length, before, "No model runs the message.");
    assert.equal(agentOf(lone.id).model, BACKUP, "The agent keeps the chosen model.");
    assert.ok(errorsFor(lone.id, since).length > 0, "The error shows.");
    refuseModelSwitch([]);
    await restart();
    return { status: outcome.status };
  });

  await check("a request that the model refuses after it wrote text shows the error", async () => {
    const refused = await withBackup("Halfway");
    const since = events.length;
    const before = turns().length;
    const outcome = await send(refused.id, "refused-request-after-work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "No backup runs the work again.",
    );
    assert.equal(agentOf(refused.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(refused.id, since).length > 0, "The error shows.");
    await restart();
    return { status: outcome.status };
  });

  await check("a turn that wrote text before a dropped connection continues on the backup model", async () => {
    const dropper = await withBackup("Dropper");
    failing([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(dropper.id, "drop-then-fail");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    assert.ok(ran[1]?.input.includes("Continue the unfinished task"), "The backup continues the work.");
    assert.equal(agentOf(dropper.id).model, BACKUP, "The agent is on the backup model.");
    assert.deepEqual(errorsFor(dropper.id, since), [], "No error shows for the moved turn.");
    failing([]);
    await restart();
    return { ran: ran.map((turn) => turn.model) };
  });

  await check("a thread turn moves to the backup model", async () => {
    const threader = await withBackup("Threader");
    failing([PRIMARY]);
    const before = turns().length;
    const task = await runCauseEffect(service.startTask({ agentId: threader.id, text: "work" }));
    await waitFor("the thread to complete on the backup", () =>
      service.readTask(threader.id, task.id).messages.some((message) => message.text === "Done."),
    );
    const ran = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(ran, [PRIMARY, BACKUP], "The thread ran on the own model, then on the backup.");
    assert.equal(agentOf(threader.id).model, BACKUP, "The agent is on the backup model.");
    failing([]);
    await restart();
    return { taskId: task.id, ran };
  });

  await check("a WhatsApp conversation turn moves to the backup model", async () => {
    const replier = await withBackup("Replier");
    failing([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const ends: { status: string; answer: string | null }[] = [];
    const stopListening = service.messaging.onActivity((activity) => {
      if (activity.type === "finished" && activity.link.platformChannelId === "failover@g.us")
        ends.push({ status: activity.status, answer: activity.answer });
    });
    try {
      const connection = service.messaging.store.ensureConnection("whatsapp", "48100000000", "Phone");
      service.messaging.store.updateConnection(connection.connectionId, { enabled: true });
      const received = await runCauseEffect(
        service.messaging.receive({
          connectionId: connection.connectionId,
          agentId: replier.id,
          platformChannelId: "failover@g.us",
          threadKey: "failover",
          isDirect: false,
          title: "Group",
          text: "work",
          sourcePaths: [],
          origin: { authorId: "48200000000", authorName: "Client", platformMessageId: "failover-message" },
          idempotencyKey: "whatsapp:failover",
        }),
      );
      assert.equal(received.status, "queued");
      const linkId = received.status === "queued" ? received.link.linkId : "";
      await waitFor("the conversation's request to end", () => ends.length > 0);
      await waitFor(
        "the conversation's requests to settle",
        () => mailbox.unresolvedMessagingDeliveries(linkId).length === 0,
      );
    } finally {
      stopListening();
    }
    const ran = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(ran, [PRIMARY, BACKUP], "The message ran on the own model, then on the backup.");
    assert.deepEqual(ends, [{ status: "completed", answer: "Done." }], "The conversation gets the backup's answer.");
    assert.equal(agentOf(replier.id).model, BACKUP, "The agent is on the backup model.");
    assert.deepEqual(errorsFor(replier.id, since), [], "No error shows for the moved turn.");
    failing([]);
    await restart();
    return { ran, ends };
  });

  await check("a thread turn that wrote text continues on the backup model", async () => {
    const threader = await withBackup("Weaver");
    failing([PRIMARY]);
    const before = turns().length;
    const task = await runCauseEffect(service.startTask({ agentId: threader.id, text: "act-then-fail" }));
    await waitFor("the thread with work to complete on the backup", () =>
      service.readTask(threader.id, task.id).messages.some((message) => message.text === "Done."),
    );
    const order = () =>
      service
        .readTask(threader.id, task.id)
        .messages.filter((message) => message.author !== "system" && message.text.trim())
        .map((message) => message.text);
    const expected = ["act-then-fail", "Partial answer.", "Done."];
    assert.deepEqual(order(), expected, "The thread shows the stopped text, then the backup's answer.");
    assert.ok(turns().slice(before).at(-1)?.input.includes("Continue the unfinished task"));
    failing([]);
    await restart();
    assert.deepEqual(order(), expected, "The thread keeps the order after a restart.");
    return { taskId: task.id, order: order() };
  });

  await check("a usage limit after partial work continues on the backup", async () => {
    const attachment = join(root, "requirements.txt");
    await writeFile(attachment, "Finish the last step after the checkpoint.\n");
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "usage-work: save a checkpoint, then finish the last step.", [attachment]);
    assert.equal(outcome.status, "completed", `The interrupted task completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
    );
    assert.ok(ran[1]?.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
    assert.ok(ran[1]?.input.includes("requirements.txt"), "The original attachment still reaches the backup.");
    const snapshot = await runCauseEffect(service.readConversation(mover.id));
    assert.equal(snapshot.messages.filter((message) => message.id === outcome.deliveryId).length, 1);
    assert.ok(snapshot.messages.some((message) => message.text.includes("Checkpoint saved.")));
    assert.deepEqual(errorsFor(mover.id, since), [], "A recovered usage limit shows no failure.");
    assert.ok(snapshot.threadId);
    await verifyHistoryKeepsRequests(mover.id);
    const finalTurnId = mailbox.getDelivery(outcome.deliveryId)?.delivery.turnId;
    assert.ok(finalTurnId);
    assert.equal(
      mailbox.deliveryForProviderMessage(stayer.id, finalTurnId),
      null,
      "History lookup never borrows another agent's delivery.",
    );
    return { outcome, models: ran.map((turn) => turn.model) };
  });

  for (const mode of ["partial", "tool-only", "chain", "chain-empty"]) {
    await check(`Codex ${mode} work continues on another provider`, async () => {
      await restart();
      const agent = await createCodex(`Codex ${mode}`, automaticBackups);
      const since = events.length;
      const beforeCodex = readLog<CodexTurn>(codexLog).length;
      const beforeClaude = turns().length;
      const beforeWork = readLog<{ caseId: string; step: string }>(workLog).length;
      const attachment = join(root, `${mode}.txt`);
      await writeFile(attachment, "Only the remaining step is needed.\n");
      const outcome = await send(agent.id, `usage-${mode} case:${mode}`, [attachment]);
      assert.equal(outcome.status, "completed", `The task completes on its backup: ${outcome.error}`);
      const attempts = readLog<CodexTurn>(codexLog).slice(beforeCodex);
      assert.equal(attempts.length, 1, "The spent provider is not run again.");
      const backups = turns().slice(beforeClaude);
      assert.deepEqual(
        backups.map((turn) => turn.model),
        mode.startsWith("chain") ? [PRIMARY, BACKUP] : [PRIMARY],
      );
      const last = backups.at(-1)?.input ?? "";
      assert.ok(last.includes("Continue the unfinished task"));
      assert.ok(
        last.includes(`checkpoint-result=${mode}`),
        "The completed tool result reaches the final provider, even without an answer bubble.",
      );
      assert.ok(last.includes(`${mode}.txt`), "The attachment reaches the final provider.");
      assert.deepEqual(
        readLog<{ caseId: string; step: string }>(workLog).slice(beforeWork),
        [
          { caseId: mode, step: "checkpoint" },
          { caseId: mode, step: "final" },
        ],
        "The completed action runs once; the backup runs only the remaining action.",
      );
      const snapshot = await runCauseEffect(service.readConversation(agent.id));
      assert.equal(snapshot.messages.filter((message) => message.id === outcome.deliveryId).length, 1);
      assert.equal(agentOf(agent.id).threadId, agent.threadId, "The public conversation is preserved.");
      assert.equal(
        agentOf(agent.id).usageLimitReturn?.provider,
        "codex",
        "A chain keeps the original return provider.",
      );
      assert.deepEqual(errorsFor(agent.id, since), []);
      const continuation = mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit;
      assert.ok(continuation?.workSteps.includes(`checkpoint-result=${mode}`));
      await verifyHistoryKeepsRequests(agent.id);
      await restart();
      assert.deepEqual(
        mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit,
        continuation,
        "The continuation survives a process restart.",
      );
      assert.equal(
        "resumeAfterUsageLimit" in (mailbox.getDelivery(outcome.deliveryId)?.delivery ?? {}),
        false,
        "Internal continuation state is not added to the queue contract.",
      );
      return { outcome, backups: backups.map((turn) => turn.model), checkpoint: mode };
    });
  }

  await check("a Codex model at capacity moves to the backup model without waiting for its retries", async () => {
    await restart();
    const agent = await createCodex("Codex capacity", automaticBackups);
    const since = events.length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const beforeClaude = turns().length;
    const outcome = await send(agent.id, "capacity-wait: answer the question.");
    assert.equal(outcome.status, "completed", `The message completes on the backup: ${outcome.error}`);
    assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1, "Codex gets the message once.");
    assert.deepEqual(
      turns()
        .slice(beforeClaude)
        .map((turn) => turn.model),
      [PRIMARY],
      "The first backup model runs the message.",
    );
    const moved = agentOf(agent.id);
    assert.equal(moved.provider, "claude", "The agent is on its backup model.");
    assert.equal(moved.usageLimitReturn?.provider, "codex", "The agent can go back to its own model.");
    assert.deepEqual(errorsFor(agent.id, since), [], "No capacity notice or error shows.");
    return { outcome, model: moved.model };
  });

  await check("a spent balance names the model it left and what to do", async () => {
    await restart();
    const agent = await createCodex("Spent balance", automaticBackups);
    const outcome = await send(agent.id, "usage-spent case:spent");
    assert.equal(outcome.status, "completed", `The task completes on its backup: ${outcome.error}`);
    const moved = agentOf(agent.id);
    assert.equal(moved.provider, "claude", "The agent is on its backup model.");
    assert.equal(moved.usageLimitReturn ?? null, null, "The agent does not go back to a spent balance by itself.");
    const spent =
      service.listModels().find((option) => option.provider === "codex" && option.id === CODEX_MODEL)?.name ??
      CODEX_MODEL;
    const notes = await markers(agent.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(
      notes,
      [sourceText("status.agent.modelSwitchedForSpentBalance", { previous: spent, model: modelName(moved.model) })],
      "The note names the spent model, the backup, and what to do.",
    );
    return { notes };
  });

  await check("without a backup, a spent balance shows its reason in the chat", async () => {
    await restart();
    const agent = await createCodex("Spent balance alone");
    const since = events.length;
    const outcome = await send(agent.id, "usage-spent case:spent-alone");
    assert.equal(outcome.status, "failed", "The message fails.");
    assert.equal(agentOf(agent.id).provider, "codex", "The agent stays on its own model.");
    const shown = errorsFor(agent.id, since).map((event) => (event.type === "error" ? event.message : ""));
    assert.deepEqual(shown, ["Your credit balance is too low to continue."], "The chat shows the reason once.");
    return { shown };
  });

  await check("without a backup, partial work waits and continues when the limit ends", async () => {
    await restart();
    const agent = await createCodex("No fallback", { automatic: true, order: [] });
    const since = events.length;
    const before = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const beforeWork = readLog<{ caseId: string; step: string }>(workLog).length;
    const receipt = await runCauseEffect(
      service.sendMessage({ agentId: agent.id, text: "usage-partial case:stopped" }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, "The message has a delivery.");
    const continuation = await waitFor(
      "the stopped work to wait in the queue",
      () =>
        mailbox.getDelivery(deliveryId)?.delivery.status === "queued" &&
        mailbox.getDelivery(deliveryId)?.resumeAfterUsageLimit,
    );
    assert.ok(continuation.workSteps.includes("checkpoint-result=stopped"), "The completed action is kept.");
    await waitFor("the limit to hold the agent", () =>
      service.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    );
    assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1, "The held work does not run again.");
    await runCauseEffect(service.resetProviderUsage("codex", DEFAULT_PROVIDER_ACCOUNT_ID));
    const status = await waitFor("the work to continue", () => {
      const value = mailbox.getDelivery(deliveryId)?.delivery.status;
      return value === "completed" || value === "failed" ? value : null;
    });
    assert.equal(status, "completed", `The work completes: ${mailbox.getDelivery(deliveryId)?.delivery.error}`);
    const attempts = readLog<CodexTurn>(codexLog).slice(beforeCodex);
    assert.equal(attempts.length, 2, "The same model continues the work once.");
    assert.ok(attempts[1]?.input.includes("Continue the unfinished task"), "The model gets a continuation request.");
    assert.deepEqual(
      readLog<{ caseId: string; step: string }>(workLog).slice(beforeWork),
      [
        { caseId: "stopped", step: "checkpoint" },
        { caseId: "stopped", step: "final" },
      ],
      "The completed action runs once; the continuation runs only the remaining action.",
    );
    assert.equal(turns().length, before, "No backup runs.");
    assert.equal(agentOf(agent.id).provider, "codex");
    assert.deepEqual(errorsFor(agent.id, since), [], "Work that waited for the limit shows no failure.");
    return { deliveryId, status, models: attempts.map((turn) => turn.model) };
  });

  await check("ask before switching continues partial work on the saved backup", async () => {
    await restart();
    const agent = await createCodex("Ask fallback", { automatic: false, order: automaticBackups.order });
    const since = events.length;
    const beforeClaude = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const outcome = await send(agent.id, "usage-partial case:ask");
    assert.equal(outcome.status, "completed", `The work completes on its backup: ${outcome.error}`);
    assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1, "The spent provider is not run again.");
    const backups = turns().slice(beforeClaude);
    assert.deepEqual(
      backups.map((turn) => turn.model),
      [PRIMARY],
    );
    assert.ok(backups[0]?.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
    assert.equal(agentOf(agent.id).provider, "claude");
    assert.equal(agentOf(agent.id).usageLimitReturn?.provider, "codex", "The agent goes back at the reset.");
    assert.deepEqual(errorsFor(agent.id, since), []);
    return { outcome, backups: backups.map((turn) => turn.model) };
  });

  await check("an exhausted backup chain waits for a reset without cycling", async () => {
    await restart();
    const agent = await createCodex("Exhausted", automaticBackups);
    const before = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const receipt = await runCauseEffect(
      service.sendMessage({ agentId: agent.id, text: "usage-exhausted case:exhausted" }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, "The message has a delivery.");
    await waitFor(
      "the last backup's limit to hold the work",
      () =>
        mailbox.getDelivery(deliveryId)?.delivery.status === "queued" &&
        turns().length - before === 2 &&
        service.getRuntimeSnapshot().usageLimits?.some((limit) => limit.agentId === agent.id),
    );
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY, BACKUP],
    );
    assert.equal(readLog<CodexTurn>(codexLog).length, beforeCodex + 1);
    assert.ok(mailbox.getDelivery(deliveryId)?.resumeAfterUsageLimit, "The waiting work keeps its continuation.");
    await runCauseEffect(service.cancelQueuedMessage(agent.id, deliveryId));
    return { deliveryId, status: mailbox.getDelivery(deliveryId)?.delivery.status };
  });

  await check("Stop ends an active task without starting a backup", async () => {
    await restart();
    const agent = await createCodex("Stopped", automaticBackups);
    const before = turns().length;
    const beforeCodex = readLog<CodexTurn>(codexLog).length;
    const receipt = await runCauseEffect(service.sendMessage({ agentId: agent.id, text: "usage-wait case:cancelled" }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId);
    const active = await waitFor("the task to start", () => readLog<CodexTurn>(codexLog).slice(beforeCodex)[0]);
    await waitFor("the first action to finish", () =>
      readLog<{ caseId: string; step: string }>(workLog).some((step) => step.caseId === "cancelled"),
    );
    await runCauseEffect(service.interrupt(agent.id, active.turnId));
    await waitFor(
      "Stop to settle the delivery",
      () => mailbox.getDelivery(deliveryId)?.delivery.status === "interrupted",
    );
    assert.equal(turns().length, before, "Stop does not fall back.");
    return { status: mailbox.getDelivery(deliveryId)?.delivery.status };
  });

  for (const { mode, caseId, models } of [
    { mode: "tool-only", caseId: "channel", models: [PRIMARY] },
    { mode: "chain-empty", caseId: "channel-chain", models: [PRIMARY, BACKUP] },
  ]) {
    await check(
      mode === "tool-only"
        ? "a channel keeps its task and completed work through fallback"
        : "a channel keeps its completed work when a backup refuses before work",
      async () => {
        await restart();
        const agent = await createCodex(`Channel ${mode}`, automaticBackups);
        const channelId = randomUUID();
        const actor = { id: "local", name: "Alex" };
        await runCauseEffect(
          service.channels.command(
            {
              type: "save",
              operationId: randomUUID(),
              channelId,
              draft: {
                name: "Continuation",
                title: "",
                instructions: "Finish the assigned work.",
                members: [{ agentId: agent.id }],
                leadAgentId: agent.id,
              },
            },
            actor,
          ),
        );
        const before = turns().length;
        await runCauseEffect(
          service.channels.command(
            {
              type: "send",
              operationId: randomUUID(),
              channelId,
              text: `usage-${mode} case:${caseId}`,
              recipientAgentId: agent.id,
              replyToMessageId: null,
              attachmentDraftIds: [],
            },
            actor,
          ),
        );
        const task = await waitFor("the channel task to end", () =>
          service.channels.store
            .tasks(channelId)
            .find((task) => ["completed", "failed", "paused"].includes(task.state)),
        );
        assert.equal(
          task.state,
          "completed",
          JSON.stringify({
            task,
            assignments: service.channels.store.assignments(channelId),
            deliveries: service.channels.store
              .assignments(channelId)
              .map((assignment) => (assignment.deliveryId ? mailbox.getDelivery(assignment.deliveryId) : null)),
          }),
        );
        assert.equal(service.channels.store.tasks(channelId).length, 1, "Fallback keeps one task.");
        const backups = turns().slice(before);
        assert.deepEqual(
          backups.map((turn) => turn.model),
          models,
        );
        const last = backups.at(-1)?.input ?? "";
        assert.ok(last.includes(`checkpoint-result=${caseId}`), "The channel backup receives the tool result.");
        assert.ok(last.includes("Continue the unfinished task"));
        return { taskId: task.id, state: task.state };
      },
    );
  }

  await check("a turn refused before work still runs on its backup", async () => {
    await restart();
    const agent = await createCodex("Before work", automaticBackups);
    const before = turns().length;
    const outcome = await send(agent.id, "usage-empty");
    assert.equal(outcome.status, "completed", outcome.error ?? "The original request completes.");
    assert.equal(turns().length, before + 1);
    assert.equal(
      mailbox.getDelivery(outcome.deliveryId)?.resumeAfterUsageLimit,
      undefined,
      "A request with no work is retried normally.",
    );
    return outcome;
  });

  await check("a task keeps its conversation and completed work through fallback", async () => {
    await restart();
    const agent = await createCodex("Task fallback", automaticBackups);
    const before = turns().length;
    const task = await runCauseEffect(service.startTask({ agentId: agent.id, text: "usage-tool-only case:task" }));
    await waitFor(
      "the task to complete on its backup",
      () =>
        turns().length > before &&
        service.readTask(agent.id, task.id).messages.some((message) => message.text === "Done."),
    );
    const snapshot = service.readTask(agent.id, task.id);
    assert.equal(snapshot.threadId, task.threadId);
    assert.ok(turns()[before]?.input.includes("checkpoint-result=task"));
    assert.ok(turns()[before]?.input.includes("Continue the unfinished task"));
    assert.equal(service.listTasks(agent.id).tasks.length, 1);
    return { taskId: task.id, threadId: snapshot.threadId };
  });

  for (const mode of ["unreadable", "slow-history"]) {
    await check(`unavailable ${mode} history does not block continuation`, async () => {
      await restart();
      const agent = await createCodex(`History ${mode}`, automaticBackups);
      const before = turns().length;
      const beforeWork = readLog<{ caseId: string; step: string }>(workLog).length;
      const outcome = await send(agent.id, `usage-${mode} case:${mode}`);
      assert.equal(outcome.status, "completed", outcome.error ?? "The backup can inspect the saved work.");
      const input = turns()[before]?.input ?? "";
      assert.ok(
        input.includes("Full tool results are unavailable"),
        "Missing history is stated, not represented as complete empty history.",
      );
      assert.ok(
        input.includes(`save-checkpoint ${mode} (completed)`),
        "Observed completed steps still reach the backup.",
      );
      assert.deepEqual(readLog<{ caseId: string; step: string }>(workLog).slice(beforeWork), [
        { caseId: mode, step: "checkpoint" },
        { caseId: mode, step: "final" },
      ]);
      return outcome;
    });
  }

  await check("a message runs again after its Claude process closed", async () => {
    await restart();
    const agent = await create("Reopened");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    await runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
    failing([PRIMARY]);
    closeBeforeRunAgain = true;
    const before = turns().length;
    const outcome = await send(agent.id, "work after close");
    closeBeforeRunAgain = false;
    failing([]);
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
    );
    assert.notEqual(ran[0]?.pid, ran[1]?.pid, "The message ran again in a new process that resumed the session.");
    await verifyHistoryKeepsRequests(agent.id);
    return { ran };
  });

  await check("a message whose uuid the saved session holds runs with a new uuid", async () => {
    const agent = await create("Holder");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    const before = turns().length;
    const outcome = await send(agent.id, "session-holds");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    assert.equal(turns().length, before + 1, "The message runs once.");
    await verifyHistoryKeepsRequests(agent.id);
    return outcome;
  });

  await check("a message that Claude skips with each uuid fails with a reason", async () => {
    const agent = await create("Skipper");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    const before = turns().length;
    const outcome = await send(agent.id, "session-skips");
    assert.equal(outcome.status, "failed", "The turn ends.");
    assert.equal(outcome.error, sourceText("error.provider.acpNoAnswer", { provider: "Claude" }));
    assert.equal(turns().length, before, "The message did not run.");
    return outcome;
  });

  await check("a usage limit after Claude read a subagent report runs nothing again", async () => {
    await restart();
    const agent = await create("Reader");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    await runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
    const since = events.length;
    const before = turns().length;
    const outcome = await send(agent.id, "usage-report-read: research in the background, then report.");
    assert.equal(outcome.status, "completed", "The request that starts the subagent completes.");
    await waitFor("the limit to hold the agent", () =>
      events.slice(since).some((event) => event.type === "usage-limit-reached"),
    );
    assert.equal(
      mailbox.getDelivery(outcome.deliveryId)?.delivery.status,
      "completed",
      "The request whose report a turn read does not go back to the queue.",
    );
    assert.ok(
      turns()
        .slice(before)
        .every((turn) => turn.model === PRIMARY),
      "Nothing runs on the backup.",
    );
    return {
      models: turns()
        .slice(before)
        .map((turn) => turn.model),
    };
  });

  await check("a usage limit on Claude's own turn for a subagent report continues on the backup", async () => {
    await restart();
    const agent = await create("Lead");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    await runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
    const since = events.length;
    const before = turns().length;
    const outcome = await send(agent.id, "usage-background: research in the background, then report.");
    assert.equal(outcome.status, "completed", "The request that starts the subagent completes.");
    const continued = await waitFor("the request to continue on the backup", () =>
      turns()
        .slice(before)
        .find((turn) => turn.model === BACKUP),
    );
    assert.ok(continued.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
    assert.ok(
      continued.input.includes('Background subagent \\"Background research\\" completed: Found three sources.'),
      "The backup gets the subagent's report.",
    );
    assert.ok(continued.input.includes("usage-background"), "The backup gets the original request.");
    await waitFor(
      "the continuation to end",
      () => mailbox.getDelivery(outcome.deliveryId)?.delivery.status === "completed",
    );
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY, PRIMARY, BACKUP],
      "The request ran, Claude's own turn was refused, and the backup continued.",
    );
    assert.equal(agentOf(agent.id).model, BACKUP, "The agent is on its backup model.");
    const notes = await markers(agent.id, MODEL_SWITCH_ITEM_TYPES["usage-limit"]);
    assert.equal(notes.length, 1, "The chat says that the agent switched.");
    assert.deepEqual(errorsFor(agent.id, since), [], "No error shows.");
    return {
      models: turns()
        .slice(before)
        .map((turn) => turn.model),
      notes,
    };
  });

  await check(
    "a usage limit on a report of a helper that Claude's own turn started continues the request",
    async () => {
      await restart();
      const agent = await create("Relay");
      await waitFor("the first turn to end", () =>
        service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
      );
      await runCauseEffect(
        service.updateAgent({
          agentId: agent.id,
          backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
        }),
      );
      const since = events.length;
      const before = turns().length;
      const outcome = await send(agent.id, "usage-relay: research in the background, then check the sources.");
      assert.equal(outcome.status, "completed", "The request that starts the first subagent completes.");
      const continued = await waitFor("the request to continue on the backup", () =>
        turns()
          .slice(before)
          .find((turn) => turn.model === BACKUP),
      );
      assert.ok(continued.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
      assert.ok(
        continued.input.includes('Background subagent \\"Source check\\" completed: Two sources hold.'),
        "The backup gets the second subagent's report.",
      );
      assert.ok(continued.input.includes("usage-relay"), "The backup gets the original request.");
      await waitFor(
        "the continuation to end",
        () => mailbox.getDelivery(outcome.deliveryId)?.delivery.status === "completed",
      );
      assert.deepEqual(
        turns()
          .slice(before)
          .map((turn) => turn.model),
        [PRIMARY, PRIMARY, PRIMARY, BACKUP],
        "The request ran, Claude's own turns ran and were refused, and the backup continued.",
      );
      assert.equal(agentOf(agent.id).model, BACKUP, "The agent is on its backup model.");
      const notes = await markers(agent.id, MODEL_SWITCH_ITEM_TYPES["usage-limit"]);
      assert.equal(notes.length, 1, "The chat says that the agent switched.");
      assert.deepEqual(errorsFor(agent.id, since), [], "No error shows.");
      return {
        models: turns()
          .slice(before)
          .map((turn) => turn.model),
        notes,
      };
    },
  );

  await check("a usage limit that refuses only a background subagent continues on the backup", async () => {
    await restart();
    const agent = await create("Lead");
    await waitFor("the first turn to end", () =>
      service.listQueue(agent.id).deliveries.every((delivery) => delivery.status === "completed"),
    );
    await runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
    const since = events.length;
    const before = turns().length;
    const outcome = await send(agent.id, "usage-subagent: research in the background, then report.");
    assert.equal(outcome.status, "completed", "The request that starts the subagent completes.");
    const continued = await waitFor("the request to continue on the backup", () =>
      turns()
        .slice(before)
        .find((turn) => turn.model === BACKUP),
    );
    assert.ok(continued.input.includes("Continue the unfinished task"), "The backup gets a continuation request.");
    assert.ok(
      continued.input.includes('Background subagent \\"Background research\\" failed'),
      "The backup gets the subagent's failure.",
    );
    assert.ok(continued.input.includes("usage-subagent"), "The backup gets the original request.");
    await waitFor(
      "the continuation to end",
      () => mailbox.getDelivery(outcome.deliveryId)?.delivery.status === "completed",
    );
    assert.equal(agentOf(agent.id).model, BACKUP, "The agent is on its backup model.");
    const notes = await markers(agent.id, MODEL_SWITCH_ITEM_TYPES["usage-limit"]);
    assert.equal(notes.length, 1, "The chat says that the agent switched.");
    assert.deepEqual(errorsFor(agent.id, since), [], "No error shows.");
    return {
      models: turns()
        .slice(before)
        .map((turn) => turn.model),
      notes,
    };
  });

  await check("a model chosen again during a provider error hold gets one try", async () => {
    await restart();
    const chooser = await withBackup("Chooser");
    failing([PRIMARY]);
    const moved = await send(chooser.id, "work");
    assert.equal(moved.status, "completed", `The message completes: ${moved.error}`);
    assert.equal(agentOf(chooser.id).model, BACKUP, "The provider error moved the agent to its backup.");
    const choose = () =>
      runCauseEffect(service.updateAgent({ agentId: chooser.id, provider: "claude", model: PRIMARY }));

    await choose();
    let before = turns().length;
    const failedTry = await send(chooser.id, "try the chosen model");
    assert.equal(failedTry.status, "completed", `The message completes: ${failedTry.error}`);
    const failedModels = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(failedModels, [PRIMARY, BACKUP], "The chosen model gets one try, then the backup answers.");
    assert.equal(agentOf(chooser.id).model, BACKUP, "The agent is on its backup again.");
    assert.equal(agentOf(chooser.id).usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");

    failing([]);
    await choose();
    before = turns().length;
    const worked = await send(chooser.id, "use the chosen model");
    assert.equal(worked.status, "completed", `The message completes: ${worked.error}`);
    const workedModels = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(workedModels, [PRIMARY], "The message runs on the chosen model.");
    const agent = agentOf(chooser.id);
    assert.equal(agent.model, PRIMARY, "The agent stays on the chosen model.");
    assert.equal(agent.usageLimitReturn, undefined, "Nothing is left to go back to.");
    return { failedModels, workedModels };
  });

  await check("a refused sign-in moves to the backup and tells the user", async () => {
    await restart();
    const agent = await withBackup("Refuser");
    failing([]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(agent.id, "refused-key work");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const models = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(models, [PRIMARY, BACKUP], "The refused model fails once, then the backup answers.");
    assert.equal(agentOf(agent.id).model, BACKUP, "The refused sign-in moved the agent to its backup.");
    const shown = errorsFor(agent.id, since).map((event) => (event.type === "error" ? event.message : ""));
    assert.equal(shown.length, 1, "The user sees why the agent left its model.");
    assert.ok(shown[0], "The shown reason has text.");

    const next = turns().length;
    const again = await send(agent.id, "refused-key again");
    assert.equal(again.status, "completed", `The next message completes: ${again.error}`);
    const nextModels = turns()
      .slice(next)
      .map((turn) => turn.model);
    assert.deepEqual(nextModels, [BACKUP], "The next message does not try the refused sign-in again.");
    return { models, shown, nextModels };
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
