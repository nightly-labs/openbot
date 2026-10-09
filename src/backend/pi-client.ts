import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Exit, Scope, Semaphore } from "effect";
import { secretElicitationField } from "./agent/prompts";
import type { AgentClient, DiagnosticOrigin } from "./agent-client";
import { type AgentCliInfo, cliSpawnTarget } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  agentMcpServers,
  claudeMcpServers,
  computerUseParam,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { mcpSecretValues, redactMcpValues } from "./mcp-redaction";
import { PendingServerRequests } from "./pending-server-requests";
import { createPiMcpExtension, type PiMcpExtension } from "./pi-mcp";
import { piMessageItems, piPrompt, piText } from "./pi-messages";
import { PiRpc } from "./pi-rpc";
import type { SpawnTarget } from "./process-confinement";
import {
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
  requiredString,
  toProviderClientOperationError,
} from "./provider-client-effects";
import type {
  ProviderHistoryConsumer,
  ProviderHistoryFragment,
  ProviderHistoryRequest,
  ReadProviderHistory,
} from "./provider-history";

export interface PiProviderOptions {
  requestTimeoutMs?: number;
  discoveryCwd?: () => string;
  confine?: (target: SpawnTarget) => SpawnTarget;
  extraEnv?: () => Record<string, string>;
  providerStateDirectory?: string;
  profileGeneration?: boolean;
  mcpServers?: McpServerSource;
  reportMcpDrops?: McpDropReporter;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpAuthorization?: McpAuthorizationSource;
  history?: {
    read?: ReadProviderHistory;
    complete?: (request: ProviderHistoryRequest) => Effect.Effect<boolean, ProviderClientOperationError>;
    append?: (threadId: string, fragment: ProviderHistoryFragment) => Effect.Effect<void, ProviderClientOperationError>;
  };
}

interface PiTurn {
  id: string;
  startedAt: number;
  messageIndex: number;
  items: Map<string, ThreadItem>;
  stopped: boolean;
  failure: string | null;
  finishing: boolean;
}
interface PiThread {
  id: string;
  cwd: string;
  params: unknown;
  rpc: PiRpc;
  mcp: LocalMcpSession;
  extension: PiMcpExtension;
  turn: PiTurn | null;
  closed: boolean;
  gate: Semaphore.Semaphore;
}
interface ClientEvents {
  notification: [AppServerNotification];
  request: [AppServerRequest];
  exit: [Error];
  diagnostic: [string, DiagnosticOrigin?];
}

/** Owns Pi's native sessions. The database owns OpenBot history and agent identity. */
export class PiAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "pi";
  readonly #bridge = new LocalMcpBridge();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #threads = new Map<string, PiThread>();
  readonly #released = new Map<string, unknown>();
  readonly #secrets = new Set<string>();
  readonly #opening = Semaphore.makeUnsafe(1);
  #scope = Scope.makeUnsafe();
  #running = false;
  constructor(
    private readonly cli: AgentCliInfo,
    private readonly options: PiProviderOptions,
  ) {
    super();
  }
  get running(): boolean {
    return this.#running;
  }
  start(): void {
    if (!this.#running) {
      this.#scope = Scope.makeUnsafe();
      this.#running = true;
    }
  }
  canReleaseProcess = (): boolean => [...this.#threads.values()].every((thread) => thread.turn === null);
  notify(): void {
    /* Pi has no post-initialize notification. */
  }
  respond(id: RequestId, value: unknown): void {
    this.#requests.resolve(id, value);
  }
  respondError(id: RequestId, error: RpcError): void {
    this.#requests.reject(id, error);
  }

  #redact = (text: string): string => {
    const values = [...this.#secrets, ...mcpSecretValues(this.options.mcpServers?.() ?? [])];
    return redactMcpValues(
      redactText(text),
      values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]),
    );
  };

  readonly stop = Effect.fn("PiAgentClient.stop")(function* (this: PiAgentClient) {
    this.#running = false;
    this.#requests.rejectAll(sourceText("error.provider.piStopped"));
    for (const thread of this.#threads.values()) yield* this.#close(thread);
    this.#threads.clear();
    this.#released.clear();
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#bridge.close().pipe(toProviderClientOperationError);
  }, Effect.uninterruptible);

  readonly #close = Effect.fn("PiAgentClient.closeThread")(function* (this: PiAgentClient, thread: PiThread) {
    thread.closed = true;
    yield* thread.rpc.stop();
    thread.mcp.close();
    yield* thread.extension.close();
  });

  readonly releaseThread = Effect.fn("PiAgentClient.releaseThread")(function* (this: PiAgentClient, id: string) {
    const thread = this.#threads.get(id);
    if (!thread) {
      this.#released.delete(id);
      return;
    }
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.piSessionBusy")));
    yield* this.#close(thread);
    this.#threads.delete(id);
    this.#released.delete(id);
  });

  readonly releaseIdleThreads = Effect.fn("PiAgentClient.releaseIdleThreads")(function* (this: PiAgentClient) {
    for (const [id, thread] of this.#threads) {
      if (thread.turn) continue;
      this.#released.set(id, thread.params);
      yield* this.#close(thread);
      this.#threads.delete(id);
    }
  });

  readonly request = Effect.fn("PiAgentClient.request")(function* <T>(
    this: PiAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    if (!this.running) return yield* providerFailure(new Error(sourceText("error.provider.piStopped")));
    let response: unknown;
    switch (method) {
      case "initialize":
        response = {};
        break;
      case "account/rateLimits/read":
        response = { rateLimits: null, rateLimitsByLimitId: null };
        break;
      case "plugin/list":
        response = { marketplaces: [] };
        break;
      case "account/read": {
        const models = yield* this.#models(timeoutMs);
        response = { account: models.length ? { type: "pi", email: null } : null, requiresOpenaiAuth: false };
        break;
      }
      case "model/list":
        response = { data: yield* this.#models(timeoutMs) };
        break;
      case "thread/start":
      case "thread/resume": {
        const thread = yield* this.#opening.withPermit(this.#open(params, method === "thread/resume"));
        response = { thread: { id: thread.id } };
        break;
      }
      case "thread/read": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const turns: Array<{ id: string; status?: string; startedAt?: number; items: ThreadItem[] }> = [];
        if (isRecord(params) && params.includeTurns === true)
          yield* this.readHistory(
            {
              threadId: id,
              items: "full",
              ...(getString(params, "cwd") ? { cwd: getString(params, "cwd") ?? undefined } : {}),
            },
            (fragment) =>
              Effect.sync(() => {
                turns.unshift({
                  id: fragment.turnId,
                  ...(fragment.status ? { status: fragment.status } : {}),
                  ...(fragment.startedAt ? { startedAt: fragment.startedAt } : {}),
                  items: fragment.items,
                });
                return true;
              }),
          );
        else yield* this.#thread(id, params);
        response = { thread: { id, turns } };
        break;
      }
      case "turn/start":
      case "turn/steer": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const thread = yield* this.#thread(id, params);
        response = yield* thread.gate.withPermit(this.#prompt(thread, params, method === "turn/steer"));
        break;
      }
      case "turn/interrupt": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const thread = this.#threads.get(id);
        if (thread?.turn) {
          thread.turn.stopped = true;
          yield* thread.rpc.request({ type: "clear_queue" });
          yield* thread.rpc.request({ type: "abort" });
        }
        response = {};
        break;
      }
      case "thread/compact/start": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const thread = yield* this.#thread(id, params);
        yield* thread.gate.withPermit(thread.rpc.request({ type: "compact" }, timeoutMs ?? 120_000));
        response = {};
        break;
      }
      default:
        return yield* providerFailure(new Error(`Pi adapter does not implement ${method}.`));
    }
    return yield* providerSync(() => decoder(response));
  });

  readonly #models = Effect.fn("PiAgentClient.models")(function* (this: PiAgentClient, timeoutMs?: number) {
    const rpc = new PiRpc(this.#redact);
    rpc.on("diagnostic", (text) => this.emit("diagnostic", text));
    rpc.on("record", (record) => {
      if (
        record.type === "extension_ui_request" &&
        isString(record.id) &&
        ["confirm", "select", "input", "editor"].includes(String(record.method))
      )
        rpc.send({ type: "extension_ui_response", id: record.id, cancelled: true });
    });
    return yield* Effect.acquireUseRelease(
      providerSync(() => {
        this.#spawn(rpc, this.options.discoveryCwd?.() ?? process.cwd(), ["--no-session", "--no-tools"], {});
        return rpc;
      }),
      (connection) =>
        Effect.gen(function* () {
          const state = yield* connection.request({ type: "get_state" }, timeoutMs);
          const listed = yield* connection.request({ type: "get_available_models" }, timeoutMs);
          const models = [];
          for (const model of getArray(listed, "models")) {
            const provider = getString(model, "provider");
            const id = getString(model, "id");
            if (!provider || !id) continue;
            const reasoning = isRecord(model) && model.reasoning === true;
            let levels: string[] = [];
            if (reasoning) {
              yield* connection.request({ type: "set_model", provider, modelId: id }, timeoutMs);
              const advertised = yield* connection.request({ type: "get_available_thinking_levels" }, timeoutMs);
              levels = getArray(advertised, "levels")
                .filter(isString)
                .map((level) => (level === "off" ? "none" : level));
            }
            const preferred = getString(state, "thinkingLevel");
            models.push({
              model: `${provider}/${id}`,
              displayName: getString(model, "name") ?? id,
              defaultReasoningEffort: preferred && levels.includes(preferred) ? preferred : (levels[0] ?? "none"),
              supportedReasoningEfforts: levels.map((reasoningEffort) => ({ reasoningEffort })),
              reasoningEffortConfigurable: levels.length > 0,
            });
          }
          return models;
        }),
      (connection) => connection.stop().pipe(Effect.orDie),
    );
  });

  #spawn(rpc: PiRpc, cwd: string, args: string[], environment: Record<string, string>): void {
    const extra = this.options.extraEnv?.() ?? {};
    for (const value of Object.values(extra)) this.#secrets.add(value);
    const target = cliSpawnTarget(this.cli.executable, ["--mode", "rpc", ...args]);
    rpc.start(this.options.confine?.(target) ?? target, cwd, { ...process.env, ...extra, ...environment });
  }

  readonly #open = Effect.fn("PiAgentClient.openThread")(function* (
    this: PiAgentClient,
    params: unknown,
    resume: boolean,
  ): Effect.fn.Return<PiThread, ProviderClientOperationError> {
    const requestedId = getString(params, "threadId");
    if (resume && requestedId) {
      const live = this.#threads.get(requestedId);
      if (live) return live;
      if (!isAbsolute(requestedId))
        return yield* providerFailure(new Error(sourceText("error.provider.piSessionMissing")));
      yield* providerCall(() => access(requestedId)).pipe(
        Effect.mapError(() => providerFailure(new Error(sourceText("error.provider.piSessionMissing")))),
      );
    }
    const cwd = yield* providerSync(() => requiredString(params, "cwd"));
    let thread: PiThread | null = null;
    let extension: PiMcpExtension | null = null;
    const rpc = new PiRpc(this.#redact);
    let retained = false;
    const mcp = yield* this.#bridge
      .createSession(
        requestedId ?? randomUUID(),
        getArray(params, "dynamicTools").filter(isNamespace),
        () => thread?.turn?.id ?? null,
        (call, signal) => this.#callTool(call, signal),
      )
      .pipe(toProviderClientOperationError);
    return yield* Effect.gen({ self: this }, function* () {
      const handoff = claudeMcpServers(
        yield* usableMcpServers(
          agentMcpServers(this.options.mcpServers?.() ?? [], computerUseParam(params)),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpAuthorization,
        ).pipe(toProviderClientOperationError),
      );
      this.options.reportMcpDrops?.("pi", handoff.dropped);
      extension = yield* createPiMcpExtension(handoff.servers, mcp, this.options.providerStateDirectory);
      for (const secret of extension.secrets) this.#secrets.add(secret);
      rpc.on("diagnostic", (text) => this.emit("diagnostic", text, { duringStop: thread?.closed ?? false }));
      rpc.on("record", (record) => {
        if (thread && !thread.closed) this.#record(thread, record);
        else if (
          record.type === "extension_ui_request" &&
          isString(record.id) &&
          ["confirm", "select", "input", "editor"].includes(String(record.method))
        )
          rpc.send({ type: "extension_ui_response", id: record.id, cancelled: true });
      });
      rpc.on("exit", (error) => {
        if (thread?.closed) return;
        if (thread?.turn) this.#background(this.#finish(thread, "failed", error.message));
        this.emit("exit", error);
      });
      const args = this.options.profileGeneration
        ? ["--no-tools", "--no-extensions", "--no-mcp"]
        : ["--extension", extension.path];
      const instructions = getString(params, "developerInstructions");
      if (instructions) args.push("--append-system-prompt", instructions);
      yield* providerSync(() => this.#spawn(rpc, cwd, args, extension?.environment ?? {}));
      if (resume && requestedId) {
        const loaded = yield* rpc.request({ type: "switch_session", sessionPath: requestedId });
        if (loaded.cancelled === true)
          return yield* providerFailure(new Error(sourceText("error.provider.piResumeCancelled")));
      }
      const state = yield* rpc.request({ type: "get_state" });
      const id = getString(state, "sessionFile");
      if (!id || (resume && id !== requestedId))
        return yield* providerFailure(new Error(sourceText("error.provider.piSessionIdentity")));
      if (!resume) {
        // Pi normally delays its first file write until a user message. Ask Pi to initialize
        // an exclusive empty file now, so idle release and restart can resume an empty thread.
        const created = yield* providerCall(async () => {
          try {
            await writeFile(id, "", { flag: "wx", mode: 0o600 });
            return true;
          } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") return false;
            throw cause;
          }
        });
        if (created) {
          const loaded = yield* rpc.request({ type: "switch_session", sessionPath: id });
          const persisted = yield* rpc.request({ type: "get_state" });
          if (loaded.cancelled === true || getString(persisted, "sessionFile") !== id)
            return yield* providerFailure(new Error(sourceText("error.provider.piResumeCancelled")));
        }
      }
      mcp.setThreadId(id);
      thread = { id, cwd, params, rpc, mcp, extension, turn: null, closed: false, gate: Semaphore.makeUnsafe(1) };
      yield* this.#configure(thread, params);
      this.#threads.set(id, thread);
      this.#released.delete(id);
      retained = true;
      return thread;
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (retained) return;
          yield* rpc.stop().pipe(Effect.orDie);
          mcp.close();
          if (extension) yield* extension.close().pipe(Effect.orDie);
        }),
      ),
    );
  });

  readonly #thread = Effect.fn("PiAgentClient.thread")(function* (
    this: PiAgentClient,
    id: string,
    params: unknown,
  ): Effect.fn.Return<PiThread, ProviderClientOperationError> {
    const existing = this.#threads.get(id);
    if (existing) return existing;
    const saved = this.#released.get(id);
    return yield* this.#opening.withPermit(
      this.#open({ ...(isRecord(saved) ? saved : {}), ...(isRecord(params) ? params : {}), threadId: id }, true),
    );
  });

  readonly #configure = Effect.fn("PiAgentClient.configure")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
  ) {
    const model = getString(params, "model");
    if (model) {
      const separator = model.indexOf("/");
      if (separator < 1) return yield* providerFailure(new Error(sourceText("error.provider.piModelInvalid")));
      yield* thread.rpc.request({
        type: "set_model",
        provider: model.slice(0, separator),
        modelId: model.slice(separator + 1),
      });
    }
    const effort = getString(params, "effort") ?? getString(params, "reasoningEffort");
    if (effort) yield* thread.rpc.request({ type: "set_thinking_level", level: effort === "none" ? "off" : effort });
  });

  readonly #prompt = Effect.fn("PiAgentClient.prompt")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
    steer: boolean,
  ) {
    if (thread.turn && !steer) return yield* providerFailure(new Error(sourceText("error.provider.piSessionBusy")));
    if (!thread.turn) yield* this.#configure(thread, params);
    const prompt = yield* piPrompt(params);
    const active = thread.turn;
    const turn: PiTurn = active ?? {
      id: getString(params, "clientUserMessageId") ?? randomUUID(),
      startedAt: Date.now() / 1_000,
      messageIndex: 0,
      items: new Map(),
      stopped: false,
      failure: null,
      finishing: false,
    };
    const userId = `${turn.id}:user:${randomUUID()}`;
    turn.items.set(userId, {
      id: userId,
      type: "userMessage",
      content: [{ type: "text", text: this.#redact(prompt.message) }],
    });
    if (!active) {
      thread.turn = turn;
      this.#notify("turn/started", thread, { turn: { id: turn.id, status: "inProgress" } });
    }
    // Subscribe before sending: a completed event can precede the prompt acknowledgement.
    yield* Effect.forkIn(
      thread.rpc
        .request(
          { type: "prompt", ...prompt, ...(steer ? { streamingBehavior: "steer" } : {}) },
          this.options.requestTimeoutMs,
        )
        .pipe(
          Effect.flatMap((response) =>
            response.disposition === "handled" && thread.turn === turn
              ? this.#finish(thread, "completed")
              : Effect.void,
          ),
          Effect.catch((failure) =>
            thread.turn === turn ? this.#finish(thread, "failed", this.#redact(String(failure.cause))) : Effect.void,
          ),
        ),
      this.#scope,
      { startImmediately: true },
    );
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  });

  #notify(method: string, thread: PiThread, params: DynamicRecord): void {
    const safe = JSON.parse(this.#redact(JSON.stringify(params)));
    this.emit("notification", {
      method,
      params: {
        threadId: thread.id,
        ...(thread.turn ? { turnId: thread.turn.id } : {}),
        ...(isRecord(safe) ? safe : {}),
      },
    });
  }
  #background(effect: Effect.Effect<void, ProviderClientOperationError>): void {
    void runCauseEffect(
      Effect.forkIn(
        effect.pipe(
          Effect.catch((failure) => Effect.sync(() => this.emit("diagnostic", this.#redact(String(failure.cause))))),
        ),
        this.#scope,
      ),
    ).catch(() => undefined);
  }

  #record(thread: PiThread, record: DynamicRecord): void {
    if (record.type === "extension_ui_request") {
      this.#background(this.#ui(thread, record));
      return;
    }
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    if (record.type === "agent_settled") {
      this.#background(
        this.#finish(
          thread,
          turn.stopped ? "interrupted" : turn.failure ? "failed" : "completed",
          turn.failure ?? undefined,
        ),
      );
    } else if (record.type === "message_update") {
      const update = getRecord(record, "assistantMessageEvent");
      const kind = getString(update, "type");
      if (kind !== "text_delta" && kind !== "thinking_delta") return;
      const delta = getString(update, "delta") ?? "";
      const index = isRecord(update) && typeof update.contentIndex === "number" ? update.contentIndex : 0;
      const id = `${turn.id}:message:${turn.messageIndex}:${kind === "text_delta" ? "text" : "thinking"}:${index}`;
      const item = turn.items.get(id) ?? { id, type: kind === "text_delta" ? "agentMessage" : "reasoning", text: "" };
      if (!turn.items.has(id)) this.#notify("item/started", thread, { item });
      item.text = (item.text ?? "") + delta;
      turn.items.set(id, item);
      this.#notify(kind === "text_delta" ? "item/agentMessage/delta" : "item/reasoning/summaryTextDelta", thread, {
        itemId: id,
        delta,
        summaryIndex: 0,
      });
    } else if (record.type === "message_end") {
      const message = getRecord(record, "message");
      if (getString(message, "role") !== "assistant") return;
      const id = `${turn.id}:message:${turn.messageIndex++}`;
      for (const key of turn.items.keys()) if (key.startsWith(`${id}:`)) turn.items.delete(key);
      for (const item of piMessageItems(message, id)) {
        if (item.id) turn.items.set(item.id, item);
        this.#notify("item/completed", thread, { item });
      }
      const stop = getString(message, "stopReason");
      turn.failure =
        stop === "error" ? this.#redact(getString(message, "errorMessage") ?? "Pi model request failed.") : null;
      if (stop === "aborted") turn.stopped = true;
      const usage = getRecord(message, "usage");
      if (usage)
        this.#notify("openbot/usage", thread, {
          usage: {
            inputTokens: usage.input,
            outputTokens: usage.output,
            cachedReadTokens: usage.cacheRead,
            cachedWriteTokens: usage.cacheWrite,
          },
        });
    } else if (record.type === "tool_execution_start" || record.type === "tool_execution_end") {
      const id = getString(record, "toolCallId");
      if (!id) return;
      const done = record.type === "tool_execution_end";
      const item: ThreadItem = {
        ...turn.items.get(id),
        id,
        type: "dynamicToolCall",
        tool: getString(record, "toolName"),
        arguments: record.args ?? turn.items.get(id)?.arguments,
        status: done ? (record.isError === true ? "failed" : "completed") : "inProgress",
        ...(done ? { contentItems: [{ type: "inputText", text: piText(getRecord(record, "result")?.content) }] } : {}),
      };
      turn.items.set(id, item);
      this.#notify(done ? "item/completed" : "item/started", thread, { item });
    }
  }

  readonly #finish = Effect.fn("PiAgentClient.finishTurn")(function* (
    this: PiAgentClient,
    thread: PiThread,
    status: string,
    failure?: string,
  ) {
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    turn.finishing = true;
    if (failure) this.#notify("error", thread, { error: { message: this.#redact(failure) }, willRetry: false });
    const append = this.options.history?.append;
    if (append) {
      const saved = yield* Effect.exit(
        append(thread.id, {
          turnId: turn.id,
          startedAt: turn.startedAt,
          status,
          items: this.#safeItems([...turn.items.values()]),
          complete: true,
        }),
      );
      if (Exit.isFailure(saved)) status = "failed";
    }
    this.#notify("turn/completed", thread, { turn: { id: turn.id, status } });
    if (thread.turn === turn) thread.turn = null;
  });

  readonly #ui = Effect.fn("PiAgentClient.userInput")(function* (
    this: PiAgentClient,
    thread: PiThread,
    record: DynamicRecord,
  ) {
    const id = getString(record, "id");
    const method = getString(record, "method");
    if (!id || !method || !["confirm", "select", "input", "editor"].includes(method)) return;
    if (this.options.profileGeneration) {
      thread.rpc.send({ type: "extension_ui_response", id, cancelled: true });
      return;
    }
    const confirm = sourceText("status.provider.confirmContinue");
    const options =
      method === "confirm"
        ? [confirm, sourceText("status.provider.confirmCancel")]
        : getArray(record, "options").filter(isString);
    const question = getString(record, "message") ?? getString(record, "title") ?? "Pi";
    const result = yield* this.#requests
      .call("item/tool/requestUserInput", {
        threadId: thread.id,
        turnId: thread.turn?.id ?? randomUUID(),
        questions: [
          {
            id,
            header: "Pi",
            question: this.#redact(question),
            isSecret: secretElicitationField(question, undefined),
            options: options.length ? options.map((label) => ({ label, description: label })) : null,
          },
        ],
      })
      .pipe(Effect.catch(() => Effect.succeed(null)));
    const answer = getArray(getRecord(getRecord(result, "answers"), id), "answers").find(isString);
    yield* providerSync(() =>
      thread.rpc.send({
        type: "extension_ui_response",
        id,
        ...(answer === undefined
          ? { cancelled: true }
          : method === "confirm"
            ? { confirmed: answer === confirm }
            : { value: answer }),
      }),
    );
  });

  readonly #callTool = Effect.fn("PiAgentClient.callTool")(function* (
    this: PiAgentClient,
    params: { threadId: string; turnId: string; callId: string; namespace: string; tool: string; arguments: unknown },
    signal: AbortSignal,
  ): Effect.fn.Return<DynamicToolResult, ProviderClientOperationError> {
    const result = yield* this.#requests.call("item/tool/call", params, signal);
    if (!isToolResult(result)) return yield* providerFailure(new Error(sourceText("error.provider.piToolInvalid")));
    return result;
  });

  readonly readHistory = Effect.fn("PiAgentClient.readHistory")(function* (
    this: PiAgentClient,
    request: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ) {
    const stored = this.options.history;
    if (!request.providerOnly && stored?.read && stored.complete && (yield* stored.complete(request))) {
      yield* stored.read(request, consume);
      return;
    }
    const thread = yield* this.#thread(request.threadId, {
      cwd: request.cwd ?? this.options.discoveryCwd?.() ?? process.cwd(),
    });
    const response = yield* thread.rpc.request({ type: "get_messages" });
    const messages = getArray(response, "messages");
    // get_messages follows the active branch. get_entries also contains abandoned branches.
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const fragment: ProviderHistoryFragment = {
        turnId: `${thread.id}:history:${index}`,
        recordsOnly: true,
        status: "completed",
        ...(isRecord(message) && typeof message.timestamp === "number" ? { startedAt: message.timestamp / 1_000 } : {}),
        items: request.items === "none" ? [] : this.#safeItems(piMessageItems(message, `pi-history:${index}`)),
        complete: true,
      };
      if (!(yield* consume(fragment))) break;
    }
  });

  #safeItems(items: ThreadItem[]): ThreadItem[] {
    return items.flatMap((item) => {
      const value = JSON.parse(this.#redact(JSON.stringify(item)));
      return isRecord(value) && isString(value.type) ? [{ ...value, type: value.type }] : [];
    });
  }
}

function isNamespace(value: unknown): value is DynamicToolNamespace {
  return (
    isRecord(value) &&
    value.type === "namespace" &&
    isString(value.name) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool) => isRecord(tool) && tool.type === "function" && isString(tool.name) && isRecord(tool.inputSchema),
    )
  );
}
function isToolResult(value: unknown): value is DynamicToolResult {
  return (
    isRecord(value) &&
    isBoolean(value.success) &&
    Array.isArray(value.contentItems) &&
    value.contentItems.every(
      (item) =>
        isRecord(item) &&
        ((item.type === "inputText" && isString(item.text)) || (item.type === "inputImage" && isString(item.imageUrl))),
    )
  );
}
