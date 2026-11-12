import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { agentProviderName, type KeyOnlyProviderId } from "@openbot/contracts/agent-providers";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type LogValue, redactText } from "@openbot/logging";
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
import { stopProcessTree } from "./windows-process-tree";

const logger = createOpenBotLogger("provider-runtime");

/**
 * How long a turn may send nothing, with no tool call or compaction open and no question to the
 * user, before OpenBot ends it. A model request that never answers held the turn open with no
 * limit (#4304). Pi ends an idle model request itself after `httpIdleTimeoutMs` (5 minutes) and
 * retries it after at most 60 seconds, so the limit is longer: Pi's own timeout and retry go first.
 */
const PI_TURN_STALL_MS = 10 * 60_000;

/**
 * How long a thread with no turn keeps its `pi` process, its MCP bridge session and its extension
 * folder. Pi opens the same session file again, so an idle thread costs only a slower first message.
 * Without it, every Pi thread kept its process until the whole provider was idle for 10 minutes.
 */
const PI_THREAD_IDLE_RELEASE_MS = 5 * 60_000;

/** How many idle threads keep their `pi` process before the timeout. The longest idle goes first. */
const PI_IDLE_THREAD_LIMIT = 1;

/**
 * How long `pi update --models` may take before the model list is read without it. It took 0.7 s in
 * Pi 1.5.0, and the catalog waits 5 s for each `model/list` request.
 */
const PI_CATALOG_REFRESH_TIMEOUT_MS = 4_000;

/**
 * The variable from which `pi update --models` reads each key-only provider's key. Pi has no built-in
 * Inception provider, so there is no catalog to refresh for it.
 */
const PI_CATALOG_KEY_VARIABLES: Record<KeyOnlyProviderId, string | null> = {
  inception: null,
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const PiSessionUsage = Schema.Struct({
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
  }),
});

/**
 * The session cost of `get_session_stats`, in USD, at the rates of Pi's model list. Pi sends it with
 * its tokens; a version that does not leaves the turns unpriced.
 */
const PiSessionCost = Schema.Struct({ cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) });

/**
 * The context fill of `get_session_stats`. Pi omits it with no model or window, and its `tokens` is
 * null after a compaction until the next model answer.
 */
const PiContextUsage = Schema.Struct({
  tokens: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  contextWindow: Schema.Finite.check(Schema.isGreaterThan(0)),
});

export interface PiProviderOptions {
  requestTimeoutMs?: number;
  discoveryCwd?: () => string;
  confine?: (target: SpawnTarget) => SpawnTarget;
  extraEnv?: () => Record<string, string>;
  /**
   * A provider that signs in only with a key, such as Inception, DeepSeek or OpenRouter, and its saved key. With
   * it the client is that provider: Pi lists only that provider's models, and the model ids have no
   * `<provider>/` prefix.
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
  /** The cause of `failure`, read before the text became a sentence for the user. */
  failureCause: CauseCode | null;
  finishing: boolean;
  lastActivityAt: number;
  /** Tool calls that started and did not end. The turn is not stalled while one is open. */
  openTools: Set<string>;
  /** Questions that wait for the user. The turn is not stalled while one is open. */
  waitingOnUser: number;
  /** Pi compacts the session. The turn is not stalled meanwhile. */
  compacting: boolean;
  /** The stall message. Pi's events after the stop do not change the failure. */
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
  /** The user's MCP tools wait for Pi's `tool_search`. */
  deferredMcp: boolean;
  turn: PiTurn | null;
  closed: boolean;
  gate: Semaphore.Semaphore;
  /**
   * Opened with the session settings of `thread/start` or `thread/resume`: OpenBot tools,
   * instructions and access. A thread that a history read opened after a restart has none of them.
   */
  configured: boolean;
  /** Closes the thread when it stays with no turn. See `PI_THREAD_IDLE_RELEASE_MS`. */
  idleRelease: ReturnType<typeof setTimeout> | null;
  /** When its last turn ended, so the longest idle thread goes first. `0` before its first turn. */
  idleSince: number;
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
  /** Pi names the phase of its text only at `message_end`, where text before a tool call becomes a step. */
  readonly provisionalAnswers = true;
  /**
   * The memories and section-mates go with the prompts, so the system prompt that a reopened
   * session gets stays the same, and a live session gets a memory change too.
   */
  readonly turnContext = true;
  readonly #turnContext = new TurnContext();
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
  deferredMcpTools = (id: string): boolean => this.#threads.get(id)?.deferredMcp ?? false;
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

  /**
   * Pi starts an API error with its HTTP status. A key provider's 401 and 402 point at the saved key.
   * A 403 is the model service's refusal, not an OpenBot permission: the text keeps the service's
   * reason, which the generic permission sentence dropped (#6649).
   */
  #failureText(message: string | null): string {
    if (message && this.provider !== "pi") {
      const provider = agentProviderName(this.provider);
      if (/^401\b/u.test(message)) return sourceText("error.provider.keyProviderRefused", { provider });
      if (/^402\b/u.test(message)) return sourceText("error.provider.keyProviderNoBalance", { provider });
    }
    const refused = message === null ? null : /^403\b:?\s*([\s\S]*)$/u.exec(message);
    if (refused) {
      // Redact before the reason is cut: a cut through a secret leaves a part that no longer matches.
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
    this.#disarmIdle(thread);
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

  /**
   * Closes a thread with no turn. Its next turn opens the session again with the saved settings.
   * A thread whose gate is held tries again after the timeout.
   */
  readonly #releaseIdle = Effect.fn("PiAgentClient.releaseIdle")(function* (this: PiAgentClient, thread: PiThread) {
    // A held gate is a turn that starts, before it sets `turn`, or a compaction. Out of the map
    // before it closes, so a turn that starts during the close opens the thread again.
    const done = yield* Effect.gen({ self: this }, function* () {
      if (thread.turn || this.#threads.get(thread.id) !== thread) return;
      if (thread.configured) this.#released.set(thread.id, thread.params);
      this.#threads.delete(thread.id);
      yield* this.#close(thread);
    }).pipe(thread.gate.withPermitsIfAvailable(1));
    if (Option.isNone(done) && !thread.turn && this.#threads.get(thread.id) === thread) this.#armIdle(thread);
  });

  /** Marks a thread whose turn ended as idle, and closes the longest idle threads over the limit. */
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
        const models = yield* this.#models(timeoutMs);
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
        // A resume with no thread id opens a new session, which holds no context.
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
            // OpenRouter's `:batch` models work only through its batch API: a chat turn fails with 404.
            if (provider === "openrouter" && id.endsWith(":batch")) continue;
            const reasoning = isRecord(model) && model.reasoning === true;
            let levels: string[] = [];
            if (reasoning) {
              yield* connection.request({ type: "set_model", provider, modelId: id }, timeoutMs);
              const advertised = yield* connection.request({ type: "get_available_thinking_levels" }, timeoutMs);
              levels = getArray(advertised, "levels")
                .filter(isString)
                .map((level) => (level === "off" ? "none" : level));
            }
            const thinkingLevel = getString(state, "thinkingLevel");
            const preferred = thinkingLevel === "off" ? "none" : thinkingLevel;
            const defaultLevel = preferred && levels.includes(preferred) ? preferred : levels[0];
            models.push({
              // Pi takes any id, and Cloudflare Workers AI ids such as `@cf/moonshotai/kimi-k2.6`
              // have an `@` that the contract charset refuses (#5079).
              model: encodedModelId(keyProvider ? "" : `${provider}/`, id),
              displayName: getString(model, "name") ?? id,
              // A model without reasoning has no level. The catalog then gives it the `medium` of every
              // model that cannot change its effort.
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

  /**
   * Pi lists the model catalog that it bundled at its release, or the one it saved from its last
   * refresh. An RPC process starts that refresh in the background and saves it only when it ends,
   * but `#models` stops Pi after about 200 ms. A model that OpenRouter added after the Pi release,
   * such as the stealth model `stealth/crouton-alpha`, did not show in the picker (#4926). This runs
   * Pi's own command, which saves the refresh before the list is read.
   *
   * It runs without confinement: it is OpenBot's own command, with no model and no tools, and it
   * writes only Pi's catalog cache. Its output is ignored, so the key cannot get into a log. It never
   * fails: with no network, or with an old Pi, the list is the one that Pi has.
   */
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
              // Not a workspace: Pi would read its project settings.
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

  /** The environment of the Pi process, before its extensions add theirs. */
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
        (call, signal) => this.#callTool(call, signal),
      )
      .pipe(toProviderClientOperationError);
    this.#starting.add(rpc);
    return yield* Effect.gen({ self: this }, function* () {
      const handoff = claudeMcpServers(
        yield* usableMcpServers(
          agentMcpServers(this.options.mcpServers?.(mcpAgentParam(params)) ?? [], computerUseParam(params)),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpEndpoint,
          mcpAgentParam(params),
        ).pipe(toProviderClientOperationError),
      );
      this.options.reportMcpDrops?.(this.provider, handoff.dropped);
      // In the Workspace only sandbox, the stdio servers start in OpenBot, with the environment that Pi
      // would give them (#6191). A profile generation runs Pi with no MCP servers.
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
        if (thread?.turn) this.#background(this.#finish(thread, "failed", error.message, "provider_exited"));
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
      if (instructions) {
        // Pi reads the instructions from a file. The path keeps the launch line short: a `.cmd`
        // wrapper starts through cmd.exe, which stops at 8191 characters (#3738).
        const path = join(dirname(extension.path), "instructions.md");
        yield* providerCall(() => writeFile(path, instructions, { mode: 0o600 }));
        args.push("--append-system-prompt", path);
      }
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
      // A thread that a read opened, or whose first turn never comes, closes after the timeout too.
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
      yield* thread.rpc.request({ type: "set_model", provider: this.provider, modelId: providerModelValue(model) });
    } else if (model) {
      const separator = model.indexOf("/");
      if (separator < 1) return yield* providerFailure(new Error(sourceText("error.provider.piModelInvalid")));
      yield* thread.rpc.request({
        type: "set_model",
        provider: model.slice(0, separator),
        modelId: providerModelValue(model.slice(separator + 1)),
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
    // Pi takes one message, so the blocks go before the user's text; history readers remove them.
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
    // Subscribe before sending: a completed event can precede the prompt acknowledgement.
    yield* Effect.forkIn(
      thread.rpc.request({ type: "prompt", ...prompt, message }, this.options.requestTimeoutMs).pipe(
        Effect.flatMap((response) =>
          response.disposition === "handled" && thread.turn === turn ? this.#finish(thread, "completed") : Effect.void,
        ),
        Effect.catch((failure) =>
          thread.turn === turn
            ? this.#finish(thread, "failed", this.#redact(String(failure.cause)), classifyFailure(failure.cause))
            : Effect.void,
        ),
      ),
      this.#scope,
      { startImmediately: true },
    );
    yield* Effect.forkIn(this.#watchStall(thread, turn), this.#scope);
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  });

  /** Fails a turn that sends nothing while no tool call or compaction runs and no question waits for the user. */
  readonly #watchStall = Effect.fn("PiAgentClient.watchStall")(function* (
    this: PiAgentClient,
    thread: PiThread,
    turn: PiTurn,
  ) {
    // A stopped turn ends by its stop, as interrupted, and not as a stall.
    while (thread.turn === turn && !turn.finishing && !turn.stopped) {
      const silentFor = Date.now() - turn.lastActivityAt;
      if (silentFor < PI_TURN_STALL_MS || turn.openTools.size > 0 || turn.waitingOnUser > 0 || turn.compacting) {
        yield* Effect.sleep(silentFor < PI_TURN_STALL_MS ? PI_TURN_STALL_MS - silentFor : PI_TURN_STALL_MS);
        continue;
      }
      this.emit("diagnostic", `Pi sent nothing for ${silentFor} ms; ending turn ${turn.id}.`);
      const failure = sourceText("error.agent.turnStalled", { provider: agentProviderName(this.provider) });
      turn.stalled = failure;
      // Stop Pi before the turn ends, so that the stop cannot reach the next turn. Pi answers
      // `abort` when it is idle, after `agent_settled`, which then ends the turn as failed.
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
    // Pi takes one message, so the steer note is at its start. The user did not write it.
    this.#addUserMessage(turn, withoutTurnContext(prompt.message));
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
    // A turn notice holds only OpenBot's own `{ turn: { id, status } }`. A short saved secret could
    // mask its `turn` key or its status, and the turn would then not end (#5390).
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
    // The summary can leave the blocks out, so the next prompt sends them in full.
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
    // Pi may not have kept the prompt of a failed turn, with its blocks.
    if (status === "failed") this.#turnContext.resend(thread.id);
    if (failure)
      this.#notify("error", thread, {
        error: { message: this.#redact(failure) },
        willRetry: false,
        ...(causeCode ? { causeCode } : {}),
      });
    // Native totals survive process release/resume. Per-message usage is not a cumulative counter.
    yield* thread.rpc.request({ type: "get_session_stats" }, 2_000).pipe(
      Effect.flatMap((stats) => {
        // The meter and the automatic compaction read this. A bad fill must not drop the totals.
        const context = Schema.decodeUnknownOption(PiContextUsage)(getRecord(stats, "contextUsage"));
        if (Option.isSome(context))
          this.#notify("thread/tokenUsage/updated", thread, {
            tokenUsage: {
              last: { totalTokens: context.value.tokens },
              modelContextWindow: context.value.contextWindow,
              estimated: true,
            },
          });
        // A bad cost must not drop the totals either.
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
    // In the background: a failed close of another idle thread must not fail or delay this turn.
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
    const messages = yield* this.#readMessages(
      request.threadId,
      request.cwd ?? this.options.discoveryCwd?.() ?? process.cwd(),
    );
    // get_messages follows the active branch. get_entries also contains abandoned branches.
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

  /**
   * The messages of a session. A session that no thread has open is read on a process with no
   * tools, extensions or MCP servers, which ends after the read. An open thread started every MCP
   * server and Computer Use, and kept them for `PI_THREAD_IDLE_RELEASE_MS`. The history import at
   * startup opened one for each Pi agent, and the computer stopped responding (#6012).
   */
  readonly #readMessages = Effect.fn("PiAgentClient.readMessages")(function* (
    this: PiAgentClient,
    sessionFile: string,
    cwd: string,
  ) {
    const fromThread = (thread: PiThread) =>
      thread.rpc.request({ type: "get_messages" }).pipe(Effect.map((response) => getArray(response, "messages")));
    const live = this.#threads.get(sessionFile);
    if (live) return yield* fromThread(live);
    // The permit keeps a thread from opening this session while the short process has it open.
    return yield* this.#opening.withPermit(
      Effect.suspend(() => {
        // A thread can open the session while this read waits for the permit.
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
    // A thread registers these secrets when it writes its key extension. This read has no extension,
    // but the history can still contain the key.
    const keyProvider = this.options.keyProvider;
    const key = keyProvider?.apiKey();
    if (key) this.#secrets.add(key);
    if (!keyProvider)
      for (const secret of piCustomEndpointSecrets(this.options.customEndpoints?.() ?? [])) this.#secrets.add(secret);
    const rpc = new PiRpc(this.#redact, this.provider);
    // What Pi writes after the read, while OpenBot stops it, is not an error for the user.
    let stopping = false;
    rpc.on("diagnostic", (text) => this.emit("diagnostic", text, { duringStop: stopping }));
    return yield* Effect.acquireUseRelease(
      providerSync(() => {
        this.#spawn(rpc, cwd, ["--no-tools", "--no-extensions", "--no-mcp"], {});
        // `stop` ends the processes in this set before it waits for the read.
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

/**
 * Puts back the ids of the items of a turn after the secret masking. The masking hides the whole
 * token around a saved value, and a short saved password can occur in a UUID (#5390). OpenBot and
 * Pi make these ids; they hold no text from the model or a tool.
 */
function withOwnIds(safe: LogValue, original: DynamicRecord | ThreadItem): LogValue {
  if (!isRecord(safe)) return safe;
  const restored = { ...safe };
  if (isString(original.id)) restored.id = original.id;
  if (isString(original.itemId)) restored.itemId = original.itemId;
  const itemId = getString(getRecord(original, "item"), "id");
  if (itemId !== undefined && isRecord(restored.item)) restored.item = { ...restored.item, id: itemId };
  return restored;
}

/** Only a file that is gone retires the session. Another failure, such as no permission, can pass. */
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

/**
 * Pi's stop texts for a stream that the provider ended with an error, with no HTTP status (Pi 1.5.0).
 */
const PI_PROVIDER_STOP =
  /^(?:Provider finish_reason: error\b|Stream ended without finish_reason\b|Provider returned (?:an? )?error\b)/u;

/**
 * The JSON body of an API error: OpenAI's and Anthropic's `{ error: { message } }`, a proxy's
 * `{ error }` or `{ detail }`, or a flat `{ message }`.
 */
const PiErrorBody = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ error: Schema.Union([Schema.String, Schema.Struct({ message: Schema.String })]) }),
    Schema.Struct({ message: Schema.String }),
    Schema.Struct({ detail: Schema.String }),
  ]),
);

/** The chat shows at most 300 characters, and the translated sentence around the reason needs room. */
const PI_REFUSAL_REASON_LIMIT = 120;

/**
 * The model service's own reason in the text after a 403 status: the message of a JSON body, or the
 * text that the OpenAI SDK puts after the status. Null for no body, or a body with no message.
 */
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
  // The OpenAI SDK's text for a response with no body.
  if (!reason || /^status code \(no body\)$/iu.test(reason)) return null;
  return reason.length <= PI_REFUSAL_REASON_LIMIT
    ? reason
    : `${reason.slice(0, PI_REFUSAL_REASON_LIMIT - 1).trimEnd()}…`;
}

/**
 * The cause of a Pi model request that failed. Pi 1.5.0 starts an HTTP error with its status:
 * `402: {…}`, or `402 {…}` from the Anthropic SDK. An error inside the stream has no status.
 */
function piFailureCause(message: string | null): CauseCode {
  if (!message) return "unknown";
  const status = /^([1-5]\d\d):? /u.exec(message)?.[1];
  const cause = structuredCause(
    status === undefined ? null : httpStatusCause(Number(status)),
    classifyFailure(message),
  );
  return cause === "unknown" && PI_PROVIDER_STOP.test(message) ? "provider_unavailable" : cause;
}

/**
 * The absolute path of a file that a Pi `read`, `write` or `edit` call names, for the thread's file
 * history. Pi resolves the path as these tools do: without a leading `@`, from `~`, or from the cwd.
 */
function piToolFilePaths(tool: unknown, args: unknown, cwd: string): string[] | undefined {
  if (tool !== "read" && tool !== "write" && tool !== "edit") return undefined;
  const path = isRecord(args) && typeof args.path === "string" ? args.path.replace(/^@/u, "") : "";
  if (!path) return undefined;
  const home = path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"));
  if (path === "~" || home) return [resolve(homedir(), path.slice(2))];
  return [resolve(cwd, path)];
}
