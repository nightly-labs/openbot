import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { agentProviderName, type KeyOnlyProviderId } from "@openbot/contracts/agent-providers";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type LogValue, redactSecrets, redactText } from "@openbot/logging";
import { type CauseCode, classifyFailure, httpStatusCause, structuredCause } from "@openbot/telemetry";
import { Cause, Effect, Exit, Option, Schema, Scope, Semaphore } from "effect";
import { withoutTurnContext } from "./agent/developer-instructions";
import { secretElicitationField } from "./agent/prompts";
import { waitForSuccessfulProcess } from "./agent/provider-status";
import { TurnContext } from "./agent/turn-context";
import { type AgentClient, type DiagnosticOrigin, MissingPiSessionError, RequestTimeoutError } from "./agent-client";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import { encodedModelId, providerModelValue } from "./encoded-model-id";
import { isMissingFileError } from "./file-errors";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  agentMcpServers,
  claudeMcpServers,
  computerUseParam,
  type McpDropReporter,
  type McpEndpointSource,
  type McpServerSource,
  type McpToolRuntimeSource,
  mcpAgentParam,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { mcpSecretValues, redactMcpRecord, redactMcpValues } from "./mcp-redaction";
import type { CustomProviderSource } from "./opencode-config";
import { PendingServerRequests } from "./pending-server-requests";
import { createPiCustomEndpointExtension, piCustomEndpointSecrets } from "./pi-custom-endpoints";
import { createPiKeyExtension } from "./pi-key-providers";
import { createPiMcpExtension, type PiMcpExtension } from "./pi-mcp";
import { piMessageItems, piPrompt, piText } from "./pi-messages";
import { PI_REQUEST_TIMEOUT_MS, PiProcessClosedError, PiRpc } from "./pi-rpc";
import { piWindowsShellArguments } from "./pi-windows-shell";
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
import { stopProcessTree } from "./windows-process-tree";

const logger = createOpenBotLogger("provider-runtime");

const extensionModels = new Set<string>();

function piModelSelection(provider: string, model: string) {
  if (provider !== "pi") return { provider, modelId: providerModelValue(model) };
  const separator = model.indexOf("/");
  if (separator < 1) return undefined;
  return { provider: model.slice(0, separator), modelId: providerModelValue(model.slice(separator + 1)) };
}

const PI_TURN_STALL_MS = 10 * 60_000;

const PI_THREAD_IDLE_RELEASE_MS = 5 * 60_000;

const PI_LONG_CACHE_TTL_MS = 60 * 60_000;

const PI_START_TIMEOUT_MS = 120_000;

const PI_IDLE_THREAD_LIMIT = 1;

const PI_CATALOG_REFRESH_TIMEOUT_MS = 4_000;

const PI_CATALOG_KEY_VARIABLES: Record<KeyOnlyProviderId, string | null> = {
  inception: null,
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function piThinkingLevels(model: unknown): string[] {
  if (!isRecord(model) || model.reasoning !== true) return [];
  const map = getRecord(model, "thinkingLevelMap");
  return PI_THINKING_LEVELS.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    return level === "xhigh" || level === "max" ? mapped !== undefined : true;
  });
}

const PiSessionUsage = Schema.Struct({
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
  }),
});

const PiSessionCost = Schema.Struct({ cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) });

const PiContextUsage = Schema.Struct({
  tokens: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  contextWindow: Schema.Finite.check(Schema.isGreaterThan(0)),
});

export interface PiProviderOptions {
  requestTimeoutMs?: number;
  discoveryCwd?: () => string;
  confine?: (target: SpawnTarget) => SpawnTarget;
  extraEnv?: () => Record<string, string>;
  keyProvider?: { id: KeyOnlyProviderId; apiKey: () => string | null };
  customEndpoints?: CustomProviderSource;
  providerStateDirectory?: string;
  profileGeneration?: boolean;
  mcpServers?: McpServerSource;
  reportMcpDrops?: McpDropReporter;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpEndpoint?: McpEndpointSource;
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
  failureCause: CauseCode | null;
  finishing: boolean;
  lastActivityAt: number;
  openTools: Set<string>;
  waitingOnUser: number;
  compacting: boolean;
  stalled: string | null;
}
interface PiThread {
  id: string;
  cwd: string;
  params: unknown;
  rpc: PiRpc;
  mcp: LocalMcpSession;
  extension: PiMcpExtension;
  keyExtension: PiMcpExtension | null;
  deferredMcp: boolean;
  turn: PiTurn | null;
  closed: boolean;
  gate: Semaphore.Semaphore;
  configured: boolean;
  idleRelease: ReturnType<typeof setTimeout> | null;
  idleSince: number;
}
interface ClientEvents {
  notification: [AppServerNotification];
  request: [AppServerRequest];
  exit: [Error];
  diagnostic: [string, DiagnosticOrigin?];
}

export class PiAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly contextCompaction = "request";
  readonly #cacheTtls = new Map<string, number>();
  readonly provisionalAnswers = true;
  readonly turnContext = true;
  readonly imageInput = (): boolean => true;
  readonly #turnContext = new TurnContext();
  readonly provider: "pi" | KeyOnlyProviderId;
  readonly #bridge = new LocalMcpBridge();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #threads = new Map<string, PiThread>();
  readonly #released = new Map<string, unknown>();
  readonly #secrets = new Set<string>();
  readonly #opening = Semaphore.makeUnsafe(1);
  readonly #starting = new Set<PiRpc>();
  #scope = Scope.makeUnsafe();
  #running = false;
  constructor(
    private readonly cli: AgentCliInfo,
    private readonly options: PiProviderOptions,
  ) {
    super();
    this.provider = options.keyProvider?.id ?? "pi";
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
  deferredMcpTools = (id: string): boolean => this.#threads.get(id)?.deferredMcp ?? false;
  canReleaseProcess = (): boolean => [...this.#threads.values()].every((thread) => thread.turn === null);
  notify(): void {}
  respond(id: RequestId, value: unknown): void {
    this.#requests.resolve(id, value);
  }
  respondError(id: RequestId, error: RpcError): void {
    this.#requests.reject(id, error);
  }

  #redact = (text: string): string => redactMcpValues(redactText(text), this.#secretValues());

  #failureText(message: string | null): string {
    if (message && this.provider !== "pi") {
      const provider = agentProviderName(this.provider);
      if (/^401\b/u.test(message)) return sourceText("error.provider.keyProviderRefused", { provider });
      if (/^402\b/u.test(message) && /\bcan only afford\b/iu.test(message)) {
        return sourceText("error.provider.keyProviderLowCredit", { provider });
      }
      if (/^402\b/u.test(message)) return sourceText("error.provider.keyProviderNoBalance", { provider });
    }
    const refused = message === null ? null : /^403\b:?\s*([\s\S]*)$/u.exec(message);
    if (refused) {
      const reason = piRefusalReason(this.#redact(refused[1] ?? ""));
      return reason
        ? sourceText("error.provider.modelServiceRefusedReason", { reason })
        : sourceText("error.provider.modelServiceRefused");
    }
    return this.#redact(message ?? "Pi model request failed.");
  }

  #secretValues(): string[] {
    const values = [...this.#secrets, ...mcpSecretValues(this.options.mcpServers?.() ?? [])];
    return values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]);
  }

  readonly stop = Effect.fn("PiAgentClient.stop")(function* (this: PiAgentClient) {
    this.#running = false;
    this.#requests.rejectAll(sourceText("error.provider.piStopped"));
    for (const rpc of this.#starting) yield* rpc.stop();
    yield* this.#opening.withPermit(Effect.void);
    for (const thread of this.#threads.values()) yield* this.#close(thread);
    this.#threads.clear();
    this.#released.clear();
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#bridge.close().pipe(toProviderClientOperationError);
  }, Effect.uninterruptible);

  readonly #close = Effect.fn("PiAgentClient.closeThread")(function* (this: PiAgentClient, thread: PiThread) {
    thread.closed = true;
    this.#disarmIdle(thread);
    yield* Effect.gen(function* () {
      yield* thread.rpc.stop();
      thread.mcp.close();
      yield* thread.extension.close();
    }).pipe(Effect.ensuring(thread.keyExtension ? thread.keyExtension.close().pipe(Effect.orDie) : Effect.void));
  });

  readonly releaseThread = Effect.fn("PiAgentClient.releaseThread")(function* (this: PiAgentClient, id: string) {
    const thread = this.#threads.get(id);
    if (!thread) {
      this.#released.delete(id);
      this.#turnContext.forget(id);
      return;
    }
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.piSessionBusy")));
    yield* this.#close(thread);
    this.#threads.delete(id);
    this.#released.delete(id);
    this.#turnContext.forget(id);
  });

  readonly releaseIdleThreads = Effect.fn("PiAgentClient.releaseIdleThreads")(function* (this: PiAgentClient) {
    for (const thread of [...this.#threads.values()]) yield* this.#releaseIdle(thread);
  });

  readonly #releaseIdle = Effect.fn("PiAgentClient.releaseIdle")(function* (this: PiAgentClient, thread: PiThread) {
    const done = yield* Effect.gen({ self: this }, function* () {
      if (thread.turn || this.#threads.get(thread.id) !== thread) return;
      if (thread.configured) this.#released.set(thread.id, thread.params);
      this.#threads.delete(thread.id);
      yield* this.#close(thread);
    }).pipe(thread.gate.withPermitsIfAvailable(1));
    if (Option.isNone(done) && !thread.turn && this.#threads.get(thread.id) === thread) this.#armIdle(thread);
  });

  readonly #threadExited = Effect.fn("PiAgentClient.threadExited")(function* (
    this: PiAgentClient,
    thread: PiThread,
    error: Error,
  ) {
    logger.warn("A Pi process exited. Only its thread ends.", { provider: this.provider, error: error.message });
    if (this.#threads.get(thread.id) !== thread) return;
    if (thread.configured) this.#released.set(thread.id, thread.params);
    this.#threads.delete(thread.id);
    if (thread.turn)
      yield* error instanceof PiProcessClosedError
        ? this.#endAfterExit(thread)
        : this.#finish(thread, "failed", error.message, "provider_exited");
    yield* this.#close(thread);
  });

  #endAfterExit(thread: PiThread) {
    return thread.turn?.stopped
      ? this.#finish(thread, "interrupted")
      : this.#finish(thread, "failed", sourceText("error.provider.piThreadStopped"), "provider_exited");
  }

  readonly #markIdle = Effect.fn("PiAgentClient.markIdle")(function* (this: PiAgentClient, thread: PiThread) {
    if (thread.turn || this.#threads.get(thread.id) !== thread) return;
    thread.idleSince = Date.now();
    this.#armIdle(thread);
    const idle = [...this.#threads.values()]
      .filter((candidate) => candidate.turn === null && candidate.idleSince > 0)
      .sort((left, right) => left.idleSince - right.idleSince);
    for (const candidate of idle.slice(0, Math.max(0, idle.length - PI_IDLE_THREAD_LIMIT)))
      yield* this.#releaseIdle(candidate);
  });

  #armIdle(thread: PiThread): void {
    this.#disarmIdle(thread);
    thread.idleRelease = setTimeout(() => {
      thread.idleRelease = null;
      this.#background(this.#releaseIdle(thread));
    }, PI_THREAD_IDLE_RELEASE_MS);
    thread.idleRelease.unref?.();
  }

  #disarmIdle(thread: PiThread): void {
    if (thread.idleRelease) clearTimeout(thread.idleRelease);
    thread.idleRelease = null;
  }

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
        const startMs = Math.max(timeoutMs ?? 0, this.options.requestTimeoutMs ?? PI_REQUEST_TIMEOUT_MS);
        const models = yield* this.#models(timeoutMs, startMs);
        response = { account: models.length ? { type: this.provider, email: null } : null, requiresOpenaiAuth: false };
        break;
      }
      case "model/list":
        yield* this.#refreshCatalog();
        response = { data: yield* this.#models(timeoutMs) };
        break;
      case "thread/start":
      case "thread/resume": {
        const thread = yield* this.#opening.withPermit(this.#open(params, method === "thread/resume", true));
        const resumed = method === "thread/resume" && getString(params, "threadId") === thread.id;
        this.#turnContext.set(thread.id, params, resumed);
        response = { thread: { id: thread.id } };
        break;
      }
      case "thread/read": {
        const id = yield* providerSync(() => requiredString(params, "threadId"));
        const turns: Array<{ id: string; status?: string; startedAt?: number; items: ThreadItem[] }> = [];
        const cwd = getString(params, "cwd");
        if (isRecord(params) && params.includeTurns === true)
          yield* this.readHistory(
            {
              threadId: id,
              items: "full",
              ...(cwd ? { cwd } : {}),
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
        response = yield* thread.gate.withPermit(
          method === "turn/steer" ? this.#steer(thread, params) : this.#prompt(thread, params),
        );
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
        yield* thread.rpc.request({ type: "get_session_stats" }, 2_000).pipe(
          Effect.tap((stats) => Effect.sync(() => this.#notifyContextUsage(thread, stats))),
          Effect.ignore,
        );
        response = {};
        break;
      }
      default:
        return yield* providerFailure(new Error(`Pi adapter does not implement ${method}.`));
    }
    return yield* providerSync(() => decoder(response));
  });

  readonly #models = Effect.fn("PiAgentClient.models")(function* (
    this: PiAgentClient,
    timeoutMs?: number,
    startMs = timeoutMs,
  ) {
    const keyProvider = this.options.keyProvider;
    if (keyProvider && !keyProvider.apiKey()) return [];
    const rpc = new PiRpc(this.#redact, this.provider);
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
      Effect.gen({ self: this }, function* () {
        const keyExtension = yield* this.#keyExtension();
        yield* providerSync(() =>
          this.#spawn(
            rpc,
            this.options.discoveryCwd?.() ?? process.cwd(),
            ["--no-session", "--no-tools", ...(keyExtension ? ["--extension", keyExtension.path] : [])],
            keyExtension?.environment ?? {},
          ),
        ).pipe(Effect.onError(() => (keyExtension ? keyExtension.close().pipe(Effect.orDie) : Effect.void)));
        return { connection: rpc, keyExtension };
      }),
      ({ connection }) =>
        Effect.gen({ self: this }, function* () {
          const state = yield* connection.request({ type: "get_state" }, startMs);
          const listed = yield* connection.request({ type: "get_available_models" }, timeoutMs);
          const models = [];
          for (const model of getArray(listed, "models")) {
            const provider = getString(model, "provider");
            const id = getString(model, "id");
            if (!provider || !id || (keyProvider && provider !== keyProvider.id)) continue;
            if (provider === "openrouter" && id.endsWith(":batch")) continue;
            const levels = piThinkingLevels(model).map((level) => (level === "off" ? "none" : level));
            const thinkingLevel = getString(state, "thinkingLevel");
            const preferred = thinkingLevel === "off" ? "none" : thinkingLevel;
            const defaultLevel = preferred && levels.includes(preferred) ? preferred : levels[0];
            models.push({
              model: encodedModelId(keyProvider ? "" : `${provider}/`, id),
              displayName: getString(model, "name") ?? id,
              ...(defaultLevel === undefined ? {} : { defaultReasoningEffort: defaultLevel }),
              supportedReasoningEfforts: levels.map((reasoningEffort) => ({ reasoningEffort })),
              reasoningEffortConfigurable: levels.length > 0,
            });
          }
          return models;
        }),
      ({ connection, keyExtension }) =>
        connection
          .stop()
          .pipe(Effect.ensuring(keyExtension ? keyExtension.close().pipe(Effect.orDie) : Effect.void), Effect.orDie),
    );
  });

  readonly #refreshCatalog = Effect.fn("PiAgentClient.refreshCatalog")(function* (this: PiAgentClient) {
    const keyProvider = this.options.keyProvider;
    const environment: Record<string, string> = {};
    if (keyProvider) {
      const variable = PI_CATALOG_KEY_VARIABLES[keyProvider.id];
      const key = keyProvider.apiKey();
      if (!variable || !key) return;
      environment[variable] = key;
    }
    const target = cliSpawnTarget(this.cli.executable, ["update", "--models"]);
    const env = { ...process.env, ...cliPathEnvironment(this.cli), ...this.options.extraEnv?.(), ...environment };
    yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(target.command, target.args, {
              cwd: homedir(),
              env,
              stdio: "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
              windowsVerbatimArguments: target.windowsVerbatimArguments,
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSuccessfulProcess(child, PI_CATALOG_REFRESH_TIMEOUT_MS, "Pi model catalog refresh");
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          logger.warn("Pi could not refresh its model catalog.", {
            provider: this.provider,
            error: this.#redact(String(Cause.squash(cause))),
          }),
        ),
      ),
    );
  });

  readonly #keyExtension = Effect.fn("PiAgentClient.keyExtension")(function* (this: PiAgentClient) {
    const keyProvider = this.options.keyProvider;
    const directory = this.options.providerStateDirectory;
    if (!keyProvider) {
      const endpoints = this.options.customEndpoints?.() ?? [];
      const extension = yield* createPiCustomEndpointExtension(endpoints, directory);
      for (const secret of extension?.secrets ?? []) this.#secrets.add(secret);
      return extension;
    }
    const key = keyProvider.apiKey();
    if (!key) return null;
    const extension = yield* createPiKeyExtension(keyProvider.id, key, directory);
    for (const secret of extension.secrets) this.#secrets.add(secret);
    return extension;
  });

  #environment(): Record<string, string> {
    const extra = this.options.extraEnv?.() ?? {};
    for (const value of Object.values(extra)) this.#secrets.add(value);
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) environment[key] = value;
    return { ...environment, ...cliPathEnvironment(this.cli), ...extra };
  }

  #spawn(rpc: PiRpc, cwd: string, args: string[], environment: Record<string, string>): void {
    const target = cliSpawnTarget(this.cli.executable, ["--mode", "rpc", ...args]);
    rpc.start(this.options.confine?.(target) ?? target, cwd, { ...this.#environment(), ...environment });
  }

  readonly #open = Effect.fn("PiAgentClient.openThread")(function* (
    this: PiAgentClient,
    params: unknown,
    resume: boolean,
    configured: boolean,
  ): Effect.fn.Return<PiThread, ProviderClientOperationError> {
    const requestedId = getString(params, "threadId");
    if (resume && requestedId) {
      const live = this.#threads.get(requestedId);
      if (live && (live.configured || !configured)) return live;
      if (live) {
        const replaced = yield* live.gate.withPermit(
          Effect.gen({ self: this }, function* () {
            if (live.turn) return false;
            this.#threads.delete(requestedId);
            yield* this.#close(live);
            return true;
          }),
        );
        if (!replaced) return live;
      }
      yield* requireSessionFile(requestedId);
    }
    const cwd = yield* providerSync(() => requiredString(params, "cwd"));
    let thread: PiThread | null = null;
    let extension: PiMcpExtension | null = null;
    let keyExtension: PiMcpExtension | null = null;
    const rpc = new PiRpc(this.#redact, this.provider);
    let retained = false;
    const mcp = yield* this.#bridge
      .createSession(
        requestedId ?? randomUUID(),
        getArray(params, "dynamicTools").filter(isNamespace),
        () => thread?.turn?.id ?? null,
        (call, signal, detachAfterMs) => this.#callTool(call, signal, detachAfterMs),
      )
      .pipe(toProviderClientOperationError);
    this.#starting.add(rpc);
    const model = getString(params, "model");
    const selection = model ? piModelSelection(this.provider, model) : undefined;
    const modelKey = selection ? `${selection.provider}/${selection.modelId}` : undefined;
    const opened = yield* Effect.gen({ self: this }, function* () {
      const handoff = claudeMcpServers(
        yield* usableMcpServers(
          agentMcpServers(this.options.mcpServers?.(mcpAgentParam(params)) ?? [], computerUseParam(params)),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpEndpoint,
          mcpAgentParam(params),
        ).pipe(toProviderClientOperationError),
      );
      this.options.reportMcpDrops?.(this.provider, handoff.dropped);
      const relay =
        this.options.confine && !this.options.profileGeneration ? { environment: this.#environment(), cwd } : undefined;
      extension = yield* createPiMcpExtension(handoff.servers, mcp, this.options.providerStateDirectory, relay);
      for (const secret of extension.secrets) this.#secrets.add(secret);
      keyExtension = yield* this.#keyExtension();
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
        if (thread && this.#threads.get(thread.id) === thread) {
          this.#background(this.#threadExited(thread, error));
          return;
        }
        if (thread?.turn) this.#background(this.#finish(thread, "failed", error.message, "provider_exited"));
        this.emit("exit", error);
      });
      const args = keyExtension ? ["--extension", keyExtension.path] : [];
      const withExtensions = modelKey !== undefined && extensionModels.has(modelKey);
      args.push(
        ...(this.options.profileGeneration
          ? ["--no-tools", ...(withExtensions ? [] : ["--no-extensions"]), "--no-mcp"]
          : ["--extension", extension.path]),
      );
      if (!this.options.profileGeneration && process.platform === "win32")
        args.push(...(yield* piWindowsShellArguments(cwd, this.#environment())));
      const instructions = getString(params, "developerInstructions");
      if (instructions) {
        const path = join(dirname(extension.path), "instructions.md");
        yield* providerCall(() => writeFile(path, instructions, { mode: 0o600 }));
        args.push("--append-system-prompt", path);
      }
      if (!this.#running) return yield* providerFailure(new Error(sourceText("error.provider.piStopped")));
      const environment = { ...extension?.environment, ...keyExtension?.environment };
      yield* providerSync(() => this.#spawn(rpc, cwd, args, environment));
      if (resume && requestedId) {
        const loaded = yield* rpc.request({ type: "switch_session", sessionPath: requestedId }, PI_START_TIMEOUT_MS);
        if (loaded.cancelled === true)
          return yield* providerFailure(new Error(sourceText("error.provider.piResumeCancelled")));
      }
      const state = yield* rpc.request({ type: "get_state" }, resume && requestedId ? undefined : PI_START_TIMEOUT_MS);
      const id = getString(state, "sessionFile");
      if (!id || (resume && id !== requestedId))
        return yield* providerFailure(new Error(sourceText("error.provider.piSessionIdentity")));
      if (this.options.profileGeneration && selection && modelKey && !withExtensions) {
        const listed = yield* rpc.request({ type: "get_available_models" });
        const known = getArray(listed, "models").some(
          (item) => getString(item, "provider") === selection.provider && getString(item, "id") === selection.modelId,
        );
        if (!known) {
          extensionModels.add(modelKey);
          return null;
        }
      }
      if (!resume) {
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
      thread = {
        id,
        cwd,
        params,
        rpc,
        mcp,
        extension,
        keyExtension,
        deferredMcp: !this.options.profileGeneration && Object.keys(handoff.servers).length > 0,
        turn: null,
        closed: false,
        gate: Semaphore.makeUnsafe(1),
        configured,
        idleRelease: null,
        idleSince: 0,
      };
      yield* this.#configure(thread, params);
      this.#threads.set(id, thread);
      this.#released.delete(id);
      this.#armIdle(thread);
      retained = true;
      return thread;
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          this.#starting.delete(rpc);
          if (retained) return;
          yield* rpc.stop().pipe(Effect.orDie);
          mcp.close();
          if (extension) yield* extension.close().pipe(Effect.orDie);
          if (keyExtension) yield* keyExtension.close().pipe(Effect.orDie);
        }),
      ),
    );
    if (opened) return opened;
    return yield* this.#open(params, resume, configured).pipe(
      Effect.tapError(() => Effect.sync(() => modelKey && extensionModels.delete(modelKey))),
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
      this.#open(
        { ...(isRecord(saved) ? saved : {}), ...(isRecord(params) ? params : {}), threadId: id },
        true,
        isRecord(saved),
      ),
    );
  });

  readonly #configure = Effect.fn("PiAgentClient.configure")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
  ) {
    const model = getString(params, "model");
    if (model) {
      const selection = piModelSelection(this.provider, model);
      if (!selection) return yield* providerFailure(new Error(sourceText("error.provider.piModelInvalid")));
      yield* thread.rpc.request({ type: "set_model", ...selection });
    }
    const effort = getString(params, "effort") ?? getString(params, "reasoningEffort");
    if (effort) yield* thread.rpc.request({ type: "set_thinking_level", level: effort === "none" ? "off" : effort });
  });

  readonly #modelReadsImages = Effect.fn("PiAgentClient.modelReadsImages")(function* (thread: PiThread) {
    const state = yield* thread.rpc.request({ type: "get_state" });
    const input = getArray(getRecord(state, "model"), "input");
    return input.length === 0 || input.includes("image");
  });

  readonly #prompt = Effect.fn("PiAgentClient.prompt")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
  ) {
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.piSessionBusy")));
    yield* this.#configure(thread, params);
    const prompt = yield* piPrompt(params);
    if (this.options.profileGeneration && prompt.images && !(yield* this.#modelReadsImages(thread)))
      return yield* providerFailure(new Error(sourceText("error.workflow.modelImageUnsupported")));
    const context = this.#turnContext.take(thread.id, prompt.message.startsWith("/"));
    const message = context.length > 0 ? [...context, prompt.message].join("\n\n") : prompt.message;
    const turn: PiTurn = {
      id: getString(params, "clientTurnId") ?? getString(params, "clientUserMessageId") ?? randomUUID(),
      startedAt: Date.now() / 1_000,
      messageIndex: 0,
      items: new Map(),
      stopped: false,
      failure: null,
      failureCause: null,
      finishing: false,
      lastActivityAt: Date.now(),
      openTools: new Set(),
      waitingOnUser: 0,
      compacting: false,
      stalled: null,
    };
    this.#addUserMessage(turn, prompt.message);
    thread.turn = turn;
    this.#disarmIdle(thread);
    this.#notify("turn/started", thread, { turn: { id: turn.id, status: "inProgress" } });
    const fail = (failure: ProviderClientOperationError) =>
      thread.turn !== turn
        ? Effect.void
        : failure.cause instanceof PiProcessClosedError
          ? this.#endAfterExit(thread)
          : this.#finish(thread, "failed", this.#redact(String(failure.cause)), classifyFailure(failure.cause));
    let answered = false;
    yield* Effect.forkIn(
      thread.rpc.request({ type: "prompt", ...prompt, message }, null).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            answered = true;
          }),
        ),
        Effect.flatMap((response) =>
          response.disposition === "handled" && thread.turn === turn ? this.#finish(thread, "completed") : Effect.void,
        ),
        Effect.catch(fail),
      ),
      this.#scope,
      { startImmediately: true },
    );
    yield* Effect.forkIn(
      Effect.sleep(this.options.requestTimeoutMs ?? PI_REQUEST_TIMEOUT_MS).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            answered || thread.turn !== turn
              ? Effect.void
              : thread.rpc.request({ type: "get_state" }, this.options.requestTimeoutMs).pipe(
                  Effect.flatMap((state) =>
                    answered || turn.waitingOnUser > 0 || state.isStreaming === true || state.isCompacting === true
                      ? Effect.void
                      : fail(providerFailure(new RequestTimeoutError("Pi", "prompt"))),
                  ),
                  Effect.catch((failure) => (answered ? Effect.void : fail(failure))),
                ),
          ),
        ),
      ),
      this.#scope,
    );
    yield* Effect.forkIn(this.#watchStall(thread, turn), this.#scope);
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  });

  readonly #watchStall = Effect.fn("PiAgentClient.watchStall")(function* (
    this: PiAgentClient,
    thread: PiThread,
    turn: PiTurn,
  ) {
    while (thread.turn === turn && !turn.finishing && !turn.stopped) {
      const silentFor = Date.now() - turn.lastActivityAt;
      if (silentFor < PI_TURN_STALL_MS || turn.openTools.size > 0 || turn.waitingOnUser > 0 || turn.compacting) {
        yield* Effect.sleep(silentFor < PI_TURN_STALL_MS ? PI_TURN_STALL_MS - silentFor : PI_TURN_STALL_MS);
        continue;
      }
      this.emit("diagnostic", `Pi sent nothing for ${silentFor} ms; ending turn ${turn.id}.`);
      const failure = sourceText("error.agent.turnStalled", { provider: agentProviderName(this.provider) });
      turn.stalled = failure;
      yield* thread.rpc.request({ type: "clear_queue" }).pipe(Effect.ignore);
      yield* thread.rpc.request({ type: "abort" }).pipe(Effect.ignore);
      yield* this.#finish(thread, "failed", failure, "stalled");
    }
  });

  readonly #steer = Effect.fn("PiAgentClient.steer")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
  ) {
    const turn = thread.turn;
    if (!turn || turn.id !== getString(params, "expectedTurnId") || turn.stopped || turn.finishing)
      return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
    const prompt = yield* piPrompt(params);
    yield* thread.rpc
      .request({ type: "steer", ...prompt }, this.options.requestTimeoutMs)
      .pipe(
        Effect.tapError((failure) =>
          failure.cause instanceof RequestTimeoutError ? this.#dropSteer(thread, turn, prompt.message) : Effect.void,
        ),
      );
    if (thread.turn !== turn || turn.finishing || turn.stopped) {
      yield* thread.rpc.request({ type: "clear_queue" }).pipe(Effect.ignore);
      return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
    }
    this.#addUserMessage(turn, withoutTurnContext(prompt.message));
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  });

  readonly #dropSteer = Effect.fn("PiAgentClient.dropSteer")(
    function* (this: PiAgentClient, thread: PiThread, turn: PiTurn, message: string) {
      const cleared = yield* thread.rpc.request({ type: "clear_queue" });
      const steering = getArray(cleared, "steering").filter(isString);
      const index = steering.indexOf(message);
      if (index >= 0) steering.splice(index, 1);
      for (const text of steering) {
        if (thread.turn !== turn || turn.stopped || turn.finishing) return;
        yield* thread.rpc
          .request({ type: "steer", message: text })
          .pipe(
            Effect.catch((failure) => Effect.sync(() => this.emit("diagnostic", this.#redact(String(failure.cause))))),
          );
      }
    },
    (effect) => Effect.ignore(effect),
  );

  #addUserMessage(turn: PiTurn, message: string): void {
    const id = `${turn.id}:user:${randomUUID()}`;
    const text = redactMcpValues(redactSecrets(message), this.#secretValues(), redactSecrets);
    turn.items.set(id, { id, type: "userMessage", content: [{ type: "text", text }] });
  }

  promptCacheTtlMs(externalThreadId: string): number | null {
    return this.#cacheTtls.get(externalThreadId) ?? null;
  }

  #observeCacheWrite(threadId: string, usage: DynamicRecord | null): void {
    const written = typeof usage?.cacheWrite === "number" ? usage.cacheWrite : 0;
    const writtenForHour = typeof usage?.cacheWrite1h === "number" ? usage.cacheWrite1h : 0;
    if (written <= 0) return;
    if (writtenForHour >= written) this.#cacheTtls.set(threadId, PI_LONG_CACHE_TTL_MS);
    else this.#cacheTtls.delete(threadId);
  }

  #notifyContextUsage(thread: PiThread, stats: unknown): void {
    const context = Schema.decodeUnknownOption(PiContextUsage)(getRecord(stats, "contextUsage"));
    if (Option.isNone(context)) return;
    this.#notify("thread/tokenUsage/updated", thread, {
      tokenUsage: {
        last: { totalTokens: context.value.tokens },
        modelContextWindow: context.value.contextWindow,
        estimated: true,
      },
    });
  }

  #notify(method: string, thread: PiThread, params: DynamicRecord): void {
    const safe =
      method === "openbot/usage" ||
      method === "thread/tokenUsage/updated" ||
      method === "turn/started" ||
      method === "turn/completed"
        ? params
        : withOwnIds(redactMcpRecord(params, this.#secretValues()), params);
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
    if (record.type === "compaction_end") this.#turnContext.resend(thread.id);
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    turn.lastActivityAt = Date.now();
    if (record.type === "agent_settled") {
      const failure = turn.stalled ?? turn.failure;
      this.#background(
        this.#finish(
          thread,
          turn.stalled || (!turn.stopped && failure) ? "failed" : turn.stopped ? "interrupted" : "completed",
          failure ?? undefined,
          turn.stalled ? "stalled" : (turn.failureCause ?? undefined),
        ),
      );
    } else if (record.type === "compaction_start" || record.type === "compaction_end") {
      turn.compacting = record.type === "compaction_start";
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
      this.#observeCacheWrite(thread.id, getRecord(message, "usage"));
      const id = `${turn.id}:message:${turn.messageIndex++}`;
      for (const key of turn.items.keys()) if (key.startsWith(`${id}:`)) turn.items.delete(key);
      for (const item of piMessageItems(message, id)) {
        if (item.id) turn.items.set(item.id, item);
        this.#notify("item/completed", thread, { item });
      }
      const stop = getString(message, "stopReason");
      turn.failure = stop === "error" ? this.#failureText(getString(message, "errorMessage")) : null;
      turn.failureCause = stop === "error" ? piFailureCause(getString(message, "errorMessage")) : null;
      if (stop === "aborted") turn.stopped = true;
    } else if (record.type === "tool_execution_start" || record.type === "tool_execution_end") {
      const id = getString(record, "toolCallId");
      if (!id) return;
      const done = record.type === "tool_execution_end";
      if (done) turn.openTools.delete(id);
      else turn.openTools.add(id);
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
      this.#notify(done ? "item/completed" : "item/started", thread, {
        item,
        filePaths: piToolFilePaths(item.tool, item.arguments, thread.cwd),
      });
    }
  }

  readonly #finish = Effect.fn("PiAgentClient.finishTurn")(function* (
    this: PiAgentClient,
    thread: PiThread,
    status: string,
    failure?: string,
    causeCode?: CauseCode,
  ) {
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    turn.finishing = true;
    if (status === "failed") this.#turnContext.resend(thread.id);
    if (failure)
      this.#notify("error", thread, {
        error: { message: this.#redact(failure) },
        willRetry: false,
        ...(causeCode ? { causeCode } : {}),
      });
    yield* thread.rpc.request({ type: "get_session_stats" }, 2_000).pipe(
      Effect.flatMap((stats) => {
        this.#notifyContextUsage(thread, stats);
        const cost = Schema.decodeUnknownOption(PiSessionCost)(stats);
        return providerSync(() => ({
          ...Schema.decodeUnknownSync(PiSessionUsage)(stats),
          cost: Option.isSome(cost) ? cost.value.cost : null,
        }));
      }),
      Effect.map(({ tokens, cost }) =>
        this.#notify("openbot/usage", thread, {
          usage: {
            inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
            outputTokens: tokens.output,
            cachedReadTokens: tokens.cacheRead,
            cachedWriteTokens: tokens.cacheWrite,
          },
          ...(cost === null ? {} : { cost }),
        }),
      ),
      Effect.catch(() => Effect.void),
    );
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
    if (thread.turn === turn) thread.turn = null;
    this.#notify("turn/completed", thread, { turn: { id: turn.id, status } });
    this.#background(this.#markIdle(thread));
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
    const turn = thread.turn;
    if (turn) turn.waitingOnUser += 1;
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
      .pipe(
        Effect.catch(() => Effect.succeed(null)),
        Effect.ensuring(
          Effect.sync(() => {
            if (!turn) return;
            turn.waitingOnUser -= 1;
            turn.lastActivityAt = Date.now();
          }),
        ),
      );
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
    detachAfterMs: number | undefined,
  ): Effect.fn.Return<DynamicToolResult, ProviderClientOperationError> {
    const result = yield* this.#requests.call("item/tool/call", params, signal, detachAfterMs);
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
    const messages = yield* this.#readMessages(
      request.threadId,
      request.cwd ?? this.options.discoveryCwd?.() ?? process.cwd(),
    );
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const fragment: ProviderHistoryFragment = {
        turnId: `${request.threadId}:history:${index}`,
        recordsOnly: true,
        status: "completed",
        ...(isRecord(message) && typeof message.timestamp === "number" ? { startedAt: message.timestamp / 1_000 } : {}),
        items: request.items === "none" ? [] : this.#safeItems(piMessageItems(message, `pi-history:${index}`)),
        complete: true,
      };
      if (!(yield* consume(fragment))) break;
    }
  });

  readonly #readMessages = Effect.fn("PiAgentClient.readMessages")(function* (
    this: PiAgentClient,
    sessionFile: string,
    cwd: string,
  ) {
    const fromThread = (thread: PiThread) =>
      thread.rpc.request({ type: "get_messages" }).pipe(Effect.map((response) => getArray(response, "messages")));
    const live = this.#threads.get(sessionFile);
    if (live) return yield* fromThread(live);
    return yield* this.#opening.withPermit(
      Effect.suspend(() => {
        const opened = this.#threads.get(sessionFile);
        return opened ? fromThread(opened) : this.#readOnShortProcess(sessionFile, cwd);
      }),
    );
  });

  readonly #readOnShortProcess = Effect.fn("PiAgentClient.readOnShortProcess")(function* (
    this: PiAgentClient,
    sessionFile: string,
    cwd: string,
  ) {
    yield* requireSessionFile(sessionFile);
    if (!this.#running) return yield* providerFailure(new Error(sourceText("error.provider.piStopped")));
    const keyProvider = this.options.keyProvider;
    const key = keyProvider?.apiKey();
    if (key) this.#secrets.add(key);
    if (!keyProvider)
      for (const secret of piCustomEndpointSecrets(this.options.customEndpoints?.() ?? [])) this.#secrets.add(secret);
    const rpc = new PiRpc(this.#redact, this.provider);
    let stopping = false;
    rpc.on("diagnostic", (text) => this.emit("diagnostic", text, { duringStop: stopping }));
    return yield* Effect.acquireUseRelease(
      providerSync(() => {
        this.#spawn(rpc, cwd, ["--no-tools", "--no-extensions", "--no-mcp"], {});
        this.#starting.add(rpc);
      }),
      () =>
        Effect.gen(function* () {
          const loaded = yield* rpc.request({ type: "switch_session", sessionPath: sessionFile });
          if (loaded.cancelled === true)
            return yield* providerFailure(new Error(sourceText("error.provider.piResumeCancelled")));
          return getArray(yield* rpc.request({ type: "get_messages" }), "messages");
        }),
      () =>
        Effect.sync(() => {
          stopping = true;
        }).pipe(
          Effect.andThen(rpc.stop()),
          Effect.ensuring(Effect.sync(() => this.#starting.delete(rpc))),
          Effect.orDie,
        ),
    );
  });

  #safeItems(items: ThreadItem[]): ThreadItem[] {
    const values = this.#secretValues();
    return items.flatMap((item) => {
      const value = withOwnIds(redactMcpRecord(item, values), item);
      return isRecord(value) && isString(value.type) ? [{ ...value, type: value.type }] : [];
    });
  }
}

function withOwnIds(safe: LogValue, original: DynamicRecord | ThreadItem): LogValue {
  if (!isRecord(safe)) return safe;
  const restored = { ...safe };
  if (isString(original.id)) restored.id = original.id;
  if (isString(original.itemId)) restored.itemId = original.itemId;
  const itemId = getString(getRecord(original, "item"), "id");
  if (itemId !== undefined && isRecord(restored.item)) restored.item = { ...restored.item, id: itemId };
  return restored;
}

function requireSessionFile(sessionFile: string): Effect.Effect<void, ProviderClientOperationError> {
  if (!isAbsolute(sessionFile)) return Effect.fail(providerFailure(new MissingPiSessionError()));
  return providerCall(() => access(sessionFile)).pipe(
    Effect.mapError(({ cause }) =>
      providerFailure(
        isMissingFileError(cause)
          ? new MissingPiSessionError()
          : new Error(sourceText("error.provider.piSessionMissing")),
      ),
    ),
  );
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

const PI_PROVIDER_STOP =
  /^(?:Provider finish_reason: error\b|Stream ended without finish_reason\b|Provider returned (?:an? )?error\b)/u;

const PiErrorBody = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ error: Schema.Union([Schema.String, Schema.Struct({ message: Schema.String })]) }),
    Schema.Struct({ message: Schema.String }),
    Schema.Struct({ detail: Schema.String }),
  ]),
);

const PI_REFUSAL_REASON_LIMIT = 120;

function piRefusalReason(body: string): string | null {
  const decoded = Schema.decodeUnknownOption(PiErrorBody)(body.trim());
  const text = Option.isSome(decoded)
    ? "error" in decoded.value
      ? typeof decoded.value.error === "string"
        ? decoded.value.error
        : decoded.value.error.message
      : "message" in decoded.value
        ? decoded.value.message
        : decoded.value.detail
    : /^\s*[{[]/u.test(body)
      ? ""
      : body;
  const reason = text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.\s]+$/u, "");
  if (!reason || /^status code \(no body\)$/iu.test(reason)) return null;
  return reason.length <= PI_REFUSAL_REASON_LIMIT
    ? reason
    : `${reason.slice(0, PI_REFUSAL_REASON_LIMIT - 1).trimEnd()}…`;
}

function piFailureCause(message: string | null): CauseCode {
  if (!message) return "unknown";
  const status = /^([1-5]\d\d):? /u.exec(message)?.[1];
  const cause = structuredCause(
    status === undefined ? null : httpStatusCause(Number(status)),
    classifyFailure(message),
  );
  return cause === "unknown" && PI_PROVIDER_STOP.test(message) ? "provider_unavailable" : cause;
}

function piToolFilePaths(tool: unknown, args: unknown, cwd: string): string[] | undefined {
  if (tool !== "read" && tool !== "write" && tool !== "edit") return undefined;
  const path = isRecord(args) && typeof args.path === "string" ? args.path.replace(/^@/u, "") : "";
  if (!path) return undefined;
  const home = path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"));
  if (path === "~" || home) return [resolve(homedir(), path.slice(2))];
  return [resolve(cwd, path)];
}
