import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { agentProviderName, type KeyOnlyProviderId } from "@openbot/contracts/agent-providers";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { secretElicitationField } from "./agent/prompts";
import { type AgentClient, type DiagnosticOrigin, MissingPiSessionError, RequestTimeoutError } from "./agent-client";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "./cli";
import { runCauseEffect } from "./effect-boundary";
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
import { createPiCustomEndpointExtension } from "./pi-custom-endpoints";
import { createPiKeyExtension } from "./pi-key-providers";
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

const PiSessionUsage = Schema.Struct({
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
  }),
});

export interface PiProviderOptions {
  requestTimeoutMs?: number;
  discoveryCwd?: () => string;
  confine?: (target: SpawnTarget) => SpawnTarget;
  extraEnv?: () => Record<string, string>;
  /**
   * A provider that signs in only with a key, such as Inception, DeepSeek, OpenRouter or Opper, and its
   * saved key. With it the client is that provider: Pi lists only that provider's models, and the model
   * ids have no `<provider>/` prefix.
   */
  keyProvider?: { id: KeyOnlyProviderId; apiKey: () => string | null };
  /** The custom endpoints that run on Pi, read at each spawn. Only for the main `pi` client. */
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
  finishing: boolean;
}
interface PiThread {
  id: string;
  cwd: string;
  params: unknown;
  rpc: PiRpc;
  mcp: LocalMcpSession;
  extension: PiMcpExtension;
  keyExtension: PiMcpExtension | null;
  turn: PiTurn | null;
  closed: boolean;
  gate: Semaphore.Semaphore;
  /**
   * Opened with the session settings of `thread/start` or `thread/resume`: OpenBot tools,
   * instructions and access. A thread that a history read opened after a restart has none of them.
   */
  configured: boolean;
}
interface ClientEvents {
  notification: [AppServerNotification];
  request: [AppServerRequest];
  exit: [Error];
  diagnostic: [string, DiagnosticOrigin?];
}

/** Owns Pi's native sessions. The database owns OpenBot history and agent identity. */
export class PiAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly contextCompaction = "request";
  readonly provider: "pi" | KeyOnlyProviderId;
  readonly #bridge = new LocalMcpBridge();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #threads = new Map<string, PiThread>();
  readonly #released = new Map<string, unknown>();
  readonly #secrets = new Set<string>();
  readonly #opening = Semaphore.makeUnsafe(1);
  /** Processes of opens in flight. They are not in `#threads` until the open retains them. */
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

  #redact = (text: string): string => redactMcpValues(redactText(text), this.#secretValues());

  /** Pi starts an API error with its HTTP status. A key provider's 401 and 402 point at the saved key. */
  #failureText(message: string | null): string {
    if (message && this.provider !== "pi") {
      const provider = agentProviderName(this.provider);
      if (/^401\b/u.test(message)) return sourceText("error.provider.keyProviderRefused", { provider });
      if (/^402\b/u.test(message)) return sourceText("error.provider.keyProviderNoBalance", { provider });
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
    // Wait until each open in flight fails and cleans up, or retains a thread that the loop below closes.
    yield* this.#opening.withPermit(Effect.void);
    for (const thread of this.#threads.values()) yield* this.#close(thread);
    this.#threads.clear();
    this.#released.clear();
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#bridge.close().pipe(toProviderClientOperationError);
  }, Effect.uninterruptible);

  readonly #close = Effect.fn("PiAgentClient.closeThread")(function* (this: PiAgentClient, thread: PiThread) {
    thread.closed = true;
    // The key extension folder is removed also when a step before it fails.
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
      if (thread.configured) this.#released.set(id, thread.params);
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
        response = { account: models.length ? { type: this.provider, email: null } : null, requiresOpenaiAuth: false };
        break;
      }
      case "model/list":
        response = { data: yield* this.#models(timeoutMs) };
        break;
      case "thread/start":
      case "thread/resume": {
        const thread = yield* this.#opening.withPermit(this.#open(params, method === "thread/resume", true));
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
        response = {};
        break;
      }
      default:
        return yield* providerFailure(new Error(`Pi adapter does not implement ${method}.`));
    }
    return yield* providerSync(() => decoder(response));
  });

  readonly #models = Effect.fn("PiAgentClient.models")(function* (this: PiAgentClient, timeoutMs?: number) {
    // With no key a key-only provider has no models, and Pi need not start.
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
          const state = yield* connection.request({ type: "get_state" }, timeoutMs);
          const listed = yield* connection.request({ type: "get_available_models" }, timeoutMs);
          const models = [];
          for (const model of getArray(listed, "models")) {
            const provider = getString(model, "provider");
            const id = getString(model, "id");
            // A key provider's client lists only its own models. Pi also lists the models of other signed-in providers.
            if (!provider || !id || (keyProvider && provider !== keyProvider.id)) continue;
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
              model: keyProvider ? id : `${provider}/${id}`,
              displayName: getString(model, "name") ?? id,
              defaultReasoningEffort: preferred && levels.includes(preferred) ? preferred : (levels[0] ?? "none"),
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

  /** The extension that gives a key-only provider its key, or that registers the custom endpoints of `pi`. */
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

  #spawn(rpc: PiRpc, cwd: string, args: string[], environment: Record<string, string>): void {
    const extra = this.options.extraEnv?.() ?? {};
    for (const value of Object.values(extra)) this.#secrets.add(value);
    const target = cliSpawnTarget(this.cli.executable, ["--mode", "rpc", ...args]);
    rpc.start(this.options.confine?.(target) ?? target, cwd, {
      ...process.env,
      ...cliPathEnvironment(this.cli),
      ...extra,
      ...environment,
    });
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
      // The live thread has no OpenBot tools, and its next prompt would remove them from the session
      // (#3343). An idle one is replaced by a thread with the session settings.
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
      if (!isAbsolute(requestedId)) return yield* providerFailure(new MissingPiSessionError());
      // Only a file that is gone retires the session. Another failure, such as no permission, can pass.
      yield* providerCall(() => access(requestedId)).pipe(
        Effect.mapError(({ cause }) =>
          providerFailure(
            isMissingFileError(cause)
              ? new MissingPiSessionError()
              : new Error(sourceText("error.provider.piSessionMissing")),
          ),
        ),
      );
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
        (call, signal) => this.#callTool(call, signal),
      )
      .pipe(toProviderClientOperationError);
    this.#starting.add(rpc);
    return yield* Effect.gen({ self: this }, function* () {
      const handoff = claudeMcpServers(
        yield* usableMcpServers(
          agentMcpServers(this.options.mcpServers?.() ?? [], computerUseParam(params)),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpEndpoint,
          mcpAgentParam(params),
        ).pipe(toProviderClientOperationError),
      );
      this.options.reportMcpDrops?.(this.provider, handoff.dropped);
      extension = yield* createPiMcpExtension(handoff.servers, mcp, this.options.providerStateDirectory);
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
        if (thread?.turn) this.#background(this.#finish(thread, "failed", error.message));
        this.emit("exit", error);
      });
      // The key extension loads first, so that it removes the key from the environment before the
      // other extensions run.
      const args = keyExtension ? ["--extension", keyExtension.path] : [];
      args.push(
        ...(this.options.profileGeneration
          ? ["--no-tools", "--no-extensions", "--no-mcp"]
          : ["--extension", extension.path]),
      );
      const instructions = getString(params, "developerInstructions");
      if (instructions) args.push("--append-system-prompt", instructions);
      if (!this.#running) return yield* providerFailure(new Error(sourceText("error.provider.piStopped")));
      const environment = { ...extension?.environment, ...keyExtension?.environment };
      yield* providerSync(() => this.#spawn(rpc, cwd, args, environment));
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
      thread = {
        id,
        cwd,
        params,
        rpc,
        mcp,
        extension,
        keyExtension,
        turn: null,
        closed: false,
        gate: Semaphore.makeUnsafe(1),
        configured,
      };
      yield* this.#configure(thread, params);
      this.#threads.set(id, thread);
      this.#released.delete(id);
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
    if (model && this.provider !== "pi") {
      yield* thread.rpc.request({ type: "set_model", provider: this.provider, modelId: model });
    } else if (model) {
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
  ) {
    if (thread.turn) return yield* providerFailure(new Error(sourceText("error.provider.piSessionBusy")));
    yield* this.#configure(thread, params);
    const prompt = yield* piPrompt(params);
    const turn: PiTurn = {
      id: getString(params, "clientTurnId") ?? getString(params, "clientUserMessageId") ?? randomUUID(),
      startedAt: Date.now() / 1_000,
      messageIndex: 0,
      items: new Map(),
      stopped: false,
      failure: null,
      finishing: false,
    };
    this.#addUserMessage(turn, prompt.message);
    thread.turn = turn;
    this.#notify("turn/started", thread, { turn: { id: turn.id, status: "inProgress" } });
    // Subscribe before sending: a completed event can precede the prompt acknowledgement.
    yield* Effect.forkIn(
      thread.rpc.request({ type: "prompt", ...prompt }, this.options.requestTimeoutMs).pipe(
        Effect.flatMap((response) =>
          response.disposition === "handled" && thread.turn === turn ? this.#finish(thread, "completed") : Effect.void,
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

  readonly #steer = Effect.fn("PiAgentClient.steer")(function* (
    this: PiAgentClient,
    thread: PiThread,
    params: unknown,
  ) {
    const turn = thread.turn;
    // Pi starts a message for an ended turn as a run of its own, which OpenBot did not start.
    // The message then waits in the queue.
    if (!turn || turn.id !== getString(params, "expectedTurnId") || turn.stopped || turn.finishing)
      return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
    const prompt = yield* piPrompt(params);
    // Pi's `steer` also queues the message while Pi compacts, which `prompt` refuses. A refusal
    // fails only this steer, not the running turn, so the message waits in the queue (#3206).
    yield* thread.rpc.request({ type: "steer", ...prompt }, this.options.requestTimeoutMs).pipe(
      // Pi can still queue a steer that timed out, and the queue would then send the message again.
      // A refusal queues nothing, so other steers of the turn stay in Pi's queue.
      Effect.tapError((failure) =>
        failure.cause instanceof RequestTimeoutError ? this.#dropSteer(thread, turn, prompt.message) : Effect.void,
      ),
    );
    if (thread.turn !== turn || turn.finishing || turn.stopped) {
      // Pi had settled or was stopped, so its next run would take the message, or the stop removed it.
      // Remove it, as it stays queued here.
      yield* thread.rpc.request({ type: "clear_queue" }).pipe(Effect.ignore);
      return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
    }
    this.#addUserMessage(turn, prompt.message);
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  });

  /** Removes one queued steer. Pi clears its whole queue, so the other steers go back in, as text only. */
  readonly #dropSteer = Effect.fn("PiAgentClient.dropSteer")(
    function* (this: PiAgentClient, thread: PiThread, turn: PiTurn, message: string) {
      const cleared = yield* thread.rpc.request({ type: "clear_queue" });
      const steering = getArray(cleared, "steering").filter(isString);
      const index = steering.indexOf(message);
      if (index >= 0) steering.splice(index, 1);
      for (const text of steering) {
        // A steer for an ended or stopped turn would start a Pi run that OpenBot did not start.
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
    turn.items.set(id, { id, type: "userMessage", content: [{ type: "text", text: this.#redact(message) }] });
  }

  #notify(method: string, thread: PiThread, params: DynamicRecord): void {
    // Usage contains only validated numeric counters. Generic secret-name matching masks `*Tokens`.
    const safe = method === "openbot/usage" ? params : redactMcpRecord(params, this.#secretValues());
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
      turn.failure = stop === "error" ? this.#failureText(getString(message, "errorMessage")) : null;
      if (stop === "aborted") turn.stopped = true;
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
    // Native totals survive process release/resume. Per-message usage is not a cumulative counter.
    yield* thread.rpc.request({ type: "get_session_stats" }, 2_000).pipe(
      Effect.flatMap((stats) => providerSync(() => Schema.decodeUnknownSync(PiSessionUsage)(stats))),
      Effect.map(({ tokens }) =>
        this.#notify("openbot/usage", thread, {
          usage: {
            inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
            outputTokens: tokens.output,
            cachedReadTokens: tokens.cacheRead,
            cachedWriteTokens: tokens.cacheWrite,
          },
        }),
      ),
      // A crashed host cannot answer telemetry; it must not block durable completion.
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
    // Before the notice, so a session that closes when its turn ends is not busy.
    if (thread.turn === turn) thread.turn = null;
    this.#notify("turn/completed", thread, { turn: { id: turn.id, status } });
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
    const values = this.#secretValues();
    return items.flatMap((item) => {
      const value = redactMcpRecord(item, values);
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
