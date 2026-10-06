import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  ndJsonStream,
  type PermissionOption,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { acpPlanSteps, PLAN_UPDATED_METHOD } from "./agent/plan-updates";
import { elicitationOptions, elicitationValue, secretElicitationField } from "./agent/prompts";
import { isUsageLimitDiagnostic } from "./agent/provider-diagnostics";
import { AgentProcessExitError, type AgentProvider, type DiagnosticOrigin } from "./agent-client";
import { type AgentCliInfo, cliSpawnTarget } from "./cli";
import { IdleThreadPool } from "./idle-thread-pool";
import { LineTooLongError, limitLineLength } from "./jsonl";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  acpMcpServers,
  agentMcpServers,
  computerUseParam,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { PendingServerRequests } from "./pending-server-requests";
import type { SpawnTarget } from "./process-confinement";
import {
  type AccountRateLimitsReadResult,
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
import { createDiagnosticStream } from "./stderr-diagnostics";
import { stopWindowsProcessTree } from "./windows-process-tree";
import { withTimeout } from "./with-timeout";

/**
 * How long model discovery may spend on asking an agent for each model's reasoning efforts. One
 * OpenCode sweep of 49 models costs about 20ms, so this is not a target: it is the point where an
 * agent that answers slowly stops delaying the catalog the user is waiting for.
 */
const MODEL_REASONING_PROBE_BUDGET_MS = 5_000;

/**
 * How long one model's probe may take before the sweep goes on without it. An agent that stops
 * answering for one model then costs that model's efforts alone, and not the efforts of every model
 * after it in the catalog.
 */
const MODEL_REASONING_PROBE_TIMEOUT_MS = 1_000;

/**
 * What the sweep leaves of the discovery deadline for the request that follows it: the restore of the
 * model the session opened on. It is one round trip, and the catalog the caller waits for is already
 * built when it runs. The close of the probe session is not awaited and uses none of it.
 */
const MODEL_REASONING_CLEANUP_MS = 1_000;

/**
 * What discovery keeps of the caller's timeout to return with. Every request it makes ends by its own
 * deadline, which is this much before the timeout: a catalog that was read in time is worth returning,
 * and one that reaches the timeout is thrown away with the models already in it.
 */
const MODEL_DISCOVERY_RETURN_MS = 250;

/**
 * How long a failed request waits for the process to report its exit. Stdout ends first, and the
 * exit follows within milliseconds; a CLI that closed stdout and kept running is reported as it was.
 */
const EXIT_REPORT_WAIT_MS = 2_000;

/** How long OpenCode's second `session/load` waits after an internal service failure. */
const OPENCODE_LOAD_RETRY_MS = 500;

/** How many `session/list` pages OpenBot reads to find a session before it stops looking. */
const OPENCODE_SESSION_LIST_PAGES = 50;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

interface ProcessEnd {
  ending: string;
  /** The last stderr line, after `redactText` only. `AgentProcessExitError` keeps it private. */
  detail: string | null;
}

interface AcpTurn {
  id: string;
  itemId: string;
  thoughtItemId: string;
  text: string;
  thought: string;
  thoughtStarted: boolean;
  receivedOutput: boolean;
  /** The prompt told the model not to answer, so an empty turn is a success. */
  answerOptional: boolean;
  messages: ThreadItem[];
  toolNames: Map<string, string>;
  /** The ACP `kind` of each tool call; a later update can omit it. */
  toolKinds: Map<string, string>;
  /** Steered prompts that the agent refused while this turn ran; sent when the running prompt ends. */
  deferredPrompts: ContentBlock[][];
  /** The user stopped the turn, so no deferred prompt is sent. */
  stopped: boolean;
  task: Promise<void>;
}

interface AcpThread {
  id: string;
  cwd: string;
  developerInstructions: string;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  mcp: LocalMcpSession;
  activeTurn: AcpTurn | null;
  turns: Array<{ id: string; status: string; items: ThreadItem[] }>;
  dynamicTools: DynamicToolNamespace[];
  workspaceRoots: string[];
  /** Whether the session got the Computer Use server. Its MCP servers are fixed when it opens. */
  computerUse: boolean;
  idleRelease: ReturnType<typeof setTimeout> | null;
  /** Also set when the session was loaded only for a read. */
  idleSince: number;
}

/** What a closed idle session needs to be loaded again, and the turns a read answers meanwhile. */
type ReleasedAcpThread = Pick<
  AcpThread,
  "cwd" | "developerInstructions" | "dynamicTools" | "workspaceRoots" | "computerUse" | "turns"
>;

/**
 * How long a session with no turn stays open in the agent process. The agent starts the user's MCP
 * servers for each session and keeps them until the session closes, and the agent loads the same
 * session again from its own store, so an idle session costs only a slower first message.
 */
const ACP_SESSION_IDLE_RELEASE_MS = 10 * 60_000;

/**
 * How many idle sessions stay open before the timeout. Grok gives each session its own set of the
 * user's MCP servers (`npx chrome-devtools-mcp` is about 300 MB), so one turn on each of five agents
 * otherwise holds five sets for ten minutes.
 */
export const ACP_IDLE_SESSION_LIMIT = 2;

interface AcpModel {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  reasoningEffortWireValues: Map<string, string>;
  usesModelReasoningEffort: boolean | null;
}

interface AcpProviderAccount {
  email: string | null;
  planType: string | null;
}

/**
 * What OpenBot offers every ACP agent in `initialize`. One value, so the trial start that "Check
 * agent" makes (`acp-agent-check.ts`) and the real client cannot differ.
 */
export const OPENBOT_ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  elicitation: { form: {} },
  session: { configOptions: { boolean: {} } },
} as const;

export const OPENBOT_ACP_CLIENT_INFO = { name: "openbot", title: "OpenBot", version: "0.1.0" } as const;

export interface AcpProviderOptions {
  provider: AgentProvider;
  /** The name in error text. The provider name when absent; a custom agent gives its own. */
  label?: string;
  /**
   * An agent that lists no model is ready, not signed out. A custom agent can have one model that
   * it does not name, and it then runs on that model.
   */
  allowNoModels?: boolean;
  /**
   * The folder of the session that model discovery opens and closes. The app's own working folder
   * when absent. A custom agent gets an empty folder, because an unknown agent can write where its
   * session starts.
   */
  discoveryCwd?: () => string;
  /**
   * Values to mask in every diagnostic and error this client emits, read at each use: the custom
   * agent's environment values, which have no secret name that `redactText` could know them by.
   */
  redactValues?: () => readonly string[];
  profileGeneration?: boolean;
  argv: readonly string[];
  env: Record<string, string>;
  /**
   * Variables read once per spawn rather than once per client, which is what lets a key saved after
   * construction reach the next process without any other plumbing. Spread after `env`.
   */
  extraEnv?: () => Record<string, string>;
  /**
   * Wraps the command for a Workspace only agent's own process (`process-confinement.ts`). It throws
   * when this computer cannot make the sandbox, and then the process does not start.
   */
  confine?(target: SpawnTarget): SpawnTarget;
  signInMessage: string;
  /**
   * Whether the model this turn runs on may still be used. Read here, after every wait this client
   * makes for the model configuration and the prompt images, because the endpoint can be removed
   * while those run and this process would still answer on it.
   */
  servesModel?: ((modelId: string) => boolean) | undefined;
  /**
   * The user's own MCP servers, read at spawn. OpenBot's bridge servers are appended after these,
   * so a configuration can never displace the tools the agent depends on.
   */
  mcpServers?: McpServerSource | undefined;
  /** What this provider could not be given. Reported once per spawn, by `AgentService`. */
  reportMcpDrops?: McpDropReporter | undefined;
  mcpToolRuntimes?: McpToolRuntimeSource | undefined;
  mcpAuthorization?: McpAuthorizationSource | undefined;
  authenticate?(connection: ClientSideConnection, initialization: InitializeResponse): Promise<void>;
  /**
   * Reads optional identity fields that ACP does not define. A provider extension failing must not
   * turn a working authenticated process into a signed-out one, so account/read falls back to null
   * fields when this hook cannot answer.
   */
  readAccount?(connection: ClientSideConnection): Promise<Partial<AcpProviderAccount>>;
  readRateLimits?(connection: ClientSideConnection): Promise<AccountRateLimitsReadResult>;
}

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  get provider(): AgentProvider {
    return this.options.provider;
  }
  readonly #cli: AgentCliInfo;
  readonly #requestTimeoutMs: number;
  readonly #bridge = new LocalMcpBridge();
  readonly #threads = new IdleThreadPool<AcpThread, ReleasedAcpThread>({
    releaseAfterMs: ACP_SESSION_IDLE_RELEASE_MS,
    idleLimit: ACP_IDLE_SESSION_LIMIT,
    // An agent that cannot close a session and load it again would keep its MCP servers or lose it.
    canRelease: () =>
      this.#loadsSessions && Boolean(this.#initialization?.agentCapabilities?.sessionCapabilities?.close),
    snapshot: ({ cwd, developerInstructions, dynamicTools, workspaceRoots, computerUse, turns }) => ({
      cwd,
      developerInstructions,
      dynamicTools,
      workspaceRoots,
      computerUse,
      turns,
    }),
    dispose: (thread) => this.#closeSession(thread),
    reopen: (threadId, released) =>
      this.#startThread(
        {
          threadId,
          cwd: released.cwd,
          developerInstructions: released.developerInstructions,
          dynamicTools: released.dynamicTools,
          runtimeWorkspaceRoots: released.workspaceRoots,
          computerUse: released.computerUse,
        },
        true,
      ),
  });
  readonly #startingThreads = new Map<string, Promise<{ thread: { id: string } }>>();
  readonly #serverRequests = new PendingServerRequests((request) => this.emit("request", request));
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientSideConnection | null = null;
  /** How the current process ended, and its last stderr line, once its output is read to the end. */
  #ended: Promise<ProcessEnd> | null = null;
  #initialized: Promise<void> | null = null;
  #initialization: InitializeResponse | null = null;
  #models: AcpModel[] = [];
  #signedIn = false;
  #stopping = false;
  /**
   * Each process that `stop()` ended while it still ran. Its stderr is the shutdown that OpenBot
   * started. Held per process, not read from `#stopping`: a crash also calls `stop()`, and `start()`
   * clears `#stopping` before the last stderr of the previous process is read.
   */
  readonly #stoppedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();

  constructor(
    cli: AgentCliInfo,
    requestTimeoutMs = 30_000,
    private readonly options: AcpProviderOptions,
  ) {
    super();
    this.#cli = cli;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get #label(): string {
    return this.options.label ?? agentProviderName(this.provider);
  }

  /** `redactText`, and then the values this agent was started with. */
  #redact(text: string): string {
    let result = redactText(text);
    for (const value of this.options.redactValues?.() ?? []) {
      if (value.length < 4) continue;
      result = result.split(value).join("[redacted]");
    }
    return result;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null && !this.#stopping;
  }

  start(): void {
    if (this.running) return;
    this.#stopping = false;
    const direct = cliSpawnTarget(this.#cli.executable, this.options.argv);
    const target = this.options.confine ? this.options.confine(direct) : direct;
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.options.env, ...this.options.extraEnv?.() },
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
    });
    this.#process = child;
    // The SDK holds a line until its newline with no limit. At the limit the connection closes with
    // the error, so each open request fails with it, and the process ends.
    const stdout = child.stdout.pipe(
      limitLineLength(() => {
        const error = new LineTooLongError(this.#label);
        this.#fail(error, child);
        void endProcess(child);
        return error;
      }),
    );
    const stream = ndJsonStream(
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>,
    );
    this.#connection = new ClientSideConnection(
      () => ({
        requestPermission: (params) => this.#requestPermission(params),
        sessionUpdate: (params) => this.#sessionUpdate(params),
        createElicitation: (params) => this.#createElicitation(params),
        extMethod: (method, params) => this.#requestUserInput(method, params),
      }),
      stream,
    );
    // One record at a time, never one chunk at a time: a chunk can end inside a JSON record, and a
    // record read in halves keeps the credential in its second half.
    let lastDiagnostic: string | null = null;
    const diagnostics = createDiagnosticStream({
      redact: (text) => this.#redact(text),
      emit: (message) => {
        lastDiagnostic = message;
        this.emit("diagnostic", message, { duringStop: this.#stoppedProcesses.has(child) });
      },
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    // Read at `close`, not `exit`: only then is stderr read to its end, and a CLI that fails at start
    // writes the reason as its last line.
    this.#ended = new Promise((resolve) => {
      child.once("error", (error) => resolve({ ending: "it could not start", detail: this.#redact(error.message) }));
      child.once("close", (code, signal) => {
        diagnostics.flush();
        resolve({ ending: signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`, detail: lastDiagnostic });
      });
    });
    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`ACP process exited with ${suffix}.`), child);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#process;
    // After a crash `#process` is already null, so the crash reason stays an error for the user.
    if (child && child.exitCode === null) this.#stoppedProcesses.add(child);
    this.#process = null;
    this.#connection = null;
    this.#initialized = null;
    for (const thread of this.#threads.clear()) thread.mcp.close();
    this.#startingThreads.clear();
    this.#serverRequests.rejectAll("ACP session stopped.");
    await this.#bridge.close();
    if (!child || child.exitCode !== null) return;
    await endProcess(child);
  }

  releaseIdleThreads(): void {
    this.#threads.releaseIdle();
  }

  /**
   * Closes one session and keeps the agent process for the other threads. The bridge session goes
   * first, because it is this app's own child; the agent is then told to drop the session, which is
   * what ends the MCP servers it started for it. An agent that does not answer `session/close` is
   * ignored: the session is already replaced on this side.
   */
  async releaseThread(sessionId: string): Promise<void> {
    this.#threads.forget(sessionId);
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    await this.#threads.close(thread);
  }

  async #closeSession(thread: AcpThread): Promise<void> {
    thread.mcp.close();
    await this.#connection?.closeSession({ sessionId: thread.id }).catch(() => undefined);
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    const ended = this.#ended;
    try {
      return await this.#request(method, params, decoder, timeoutMs);
    } catch (error) {
      throw await this.#explainEnd(error, ended);
    }
  }

  /**
   * The error to report for a request that failed. The ACP SDK rejects every open request with a
   * bare "ACP connection closed" as soon as the CLI's stdout ends, before the process reports its
   * exit, so a CLI that fails at start read to the user as that phrase and nothing else. When the
   * process ended on its own, this waits for its exit and reports it with the CLI's last stderr line.
   */
  async #explainEnd(error: unknown, ended: Promise<ProcessEnd> | null): Promise<unknown> {
    if (!ended || this.#stopping) return error;
    const message = error instanceof Error ? error.message : "";
    if (message !== "ACP connection closed" && message !== "ACP client is not running.") return error;
    let timer: NodeJS.Timeout | undefined;
    const ending = await Promise.race([
      ended,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), EXIT_REPORT_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (ending === null) return error;
    return new AgentProcessExitError(`${this.#label} stopped before it answered (${ending.ending}).`, ending.detail, {
      cause: error,
    });
  }

  async #request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.running) throw new Error("ACP client is not running.");
    switch (method) {
      case "initialize":
        // The caller's timeout covers the first model discovery too: a CLI that was just installed
        // can take minutes to answer both.
        await this.#ensureInitialized(timeoutMs);
        return decoder({});
      case "account/read": {
        if (!this.#signedIn) return decoder({ account: null, requiresOpenaiAuth: false });
        const account = await this.#readProviderAccount(timeoutMs);
        return decoder({
          account: { type: this.provider, email: account.email, planType: account.planType },
          requiresOpenaiAuth: false,
        });
      }
      case "account/rateLimits/read":
        await this.#ensureInitialized();
        if (!this.#signedIn) return decoder({ rateLimits: null, rateLimitsByLimitId: null });
        return decoder(
          this.options.readRateLimits
            ? await withTimeout(
                this.options.readRateLimits(this.#requireConnection()),
                timeoutMs ?? this.#requestTimeoutMs,
                `${this.#label} request timed out: account/rateLimits/read`,
              )
            : { rateLimits: null, rateLimitsByLimitId: null },
        );
      case "model/list":
        await this.#ensureInitialized();
        if (this.#signedIn) {
          try {
            this.#models = await this.#discoverModels(timeoutMs);
          } catch (error) {
            // Initialization already proved that OpenCode's catalogue works. A later refresh can
            // time out while probing model options; keep the last successful list instead of making
            // a connected provider appear to have no models. Other providers report the failure.
            if (this.provider !== "opencode" || this.#models.length === 0) throw error;
          }
        }
        return decoder({
          data: this.#models.map((model) => ({
            model: model.id,
            displayName: model.name,
            description: model.description,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts.map((reasoningEffort) => ({ reasoningEffort })),
          })),
        });
      case "plugin/list":
        return decoder({ marketplaces: [] });
      case "thread/start":
        return decoder(await this.#startThread(params, false));
      case "thread/resume":
        return decoder(await this.#startThread(params, true));
      case "thread/read": {
        const threadId = requiredString(params, "threadId");
        // A closed idle session answers from the turns it kept, so a read does not start its MCP
        // servers again.
        const released = this.#threads.has(threadId) ? undefined : this.#threads.released(threadId);
        const thread = released ?? (await this.#readableThread(threadId, params));
        return decoder({ thread: { id: threadId, turns: thread?.turns ?? [] } });
      }
      case "turn/start":
        return decoder(await this.#startTurn(params, false));
      case "turn/steer":
        return decoder(await this.#startTurn(params, true));
      case "turn/interrupt": {
        const threadId = requiredString(params, "threadId");
        // A closed idle session has no turn to stop.
        if (this.#threads.isReleased(threadId)) return decoder({});
        const thread = this.#requireThread(threadId);
        // A stop also stops the steers that wait for the running prompt, if that prompt ends anyway.
        if (thread.activeTurn) thread.activeTurn.stopped = true;
        this.#requireConnection().cancel({ sessionId: thread.id });
        return decoder({});
      }
      case "thread/compact/start":
        return decoder({});
      default:
        throw new Error(`ACP adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // ACP initialization is a request/response exchange without a follow-up notification.
  }

  respond(id: RequestId, result: unknown): void {
    this.#serverRequests.resolve(id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#serverRequests.reject(id, error);
  }

  async #ensureInitialized(timeoutMs = this.#requestTimeoutMs): Promise<void> {
    if (this.#initialized) return this.#initialized;
    this.#initialized = this.#initialize(timeoutMs);
    return this.#initialized;
  }

  async #readProviderAccount(timeoutMs?: number): Promise<AcpProviderAccount> {
    if (!this.options.readAccount) return { email: null, planType: null };
    try {
      const account = await withTimeout(
        this.options.readAccount(this.#requireConnection()),
        timeoutMs ?? this.#requestTimeoutMs,
        `${this.#label} request timed out: account/read`,
      );
      return { email: account.email ?? null, planType: account.planType ?? null };
    } catch {
      return { email: null, planType: null };
    }
  }

  async #initialize(timeoutMs: number): Promise<void> {
    const connection = this.#requireConnection();
    this.#initialization = await withTimeout(
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities: OPENBOT_ACP_CLIENT_CAPABILITIES,
        clientInfo: OPENBOT_ACP_CLIENT_INFO,
      }),
      timeoutMs,
      "ACP initialization timed out.",
    );
    try {
      await this.options.authenticate?.(connection, this.#initialization);
      this.#models = await this.#discoverModels(timeoutMs);
      if (this.#models.length === 0 && !this.options.allowNoModels) {
        throw new Error(sourceText("error.provider.acpNoModels"));
      }
      this.#signedIn = true;
    } catch (error) {
      if (isAuthenticationError(error)) {
        this.#signedIn = false;
        return;
      }
      throw error;
    }
  }

  async #discoverModels(timeoutMs = this.#requestTimeoutMs): Promise<AcpModel[]> {
    const connection = this.#requireConnection();
    // One deadline for the whole discovery, read before the session opens and held short of the
    // caller's own timeout: what the sweep may spend is what a slow `session/new` left of the time
    // the caller gave `model/list`. A sweep that timed the caller out would return no catalog at all.
    const deadline = Date.now() + timeoutMs - MODEL_DISCOVERY_RETURN_MS;
    return withTimeout(
      (async () => {
        const cwd = this.options.discoveryCwd?.() ?? process.cwd();
        const probe = await connection.newSession({ cwd, mcpServers: [] });
        try {
          return await this.#modelReasoningEfforts(connection, probe, modelsFromSessionSetup(probe), deadline);
        } finally {
          // Sent always, and not awaited. An agent can run one process per session, so a probe left
          // open after a slow `session/new` used the deadline, or after `model/list` timed out, is one
          // idle process until the app quits. Not awaited, because the catalog is complete by now, and
          // an agent that is slow to close a session must not take it away.
          void connection.closeSession({ sessionId: probe.sessionId }).catch(() => undefined);
        }
      })(),
      timeoutMs,
      `${this.#label} request timed out: model/list`,
    );
  }

  /**
   * A discovery request that gives up at `until`, and reports any failure as `null`.
   *
   * The request is sent here, and not by the caller: after `until` there is nothing to send. A
   * request made anyway would still reach the agent and still change the session the sweep is about
   * to give back, and its own failure would have nobody left to read it.
   */
  async #requestBefore<T>(request: () => Promise<T>, until: number, method: string): Promise<T | null> {
    const remaining = until - Date.now();
    if (remaining <= 0) return null;
    return withTimeout(request(), remaining, `${this.#label} request timed out: ${method}`).catch(() => null);
  }

  /**
   * The reasoning efforts of each model, asked one model at a time on the session that listed them.
   *
   * An agent that holds reasoning in a session config option publishes `thought_level` for the model
   * the session is on, and a new session is on one model. Read as it arrives, every model of the
   * catalog carries that one model's efforts, and a model the session never selected carries no
   * efforts at all: OpenCode offers `minimal` to `xhigh` per model, and the Effort menu showed
   * `Medium` alone for all of them. Selecting the model on the same session makes the agent publish
   * the options of that model, so the catalog is built from one answer per model.
   *
   * Only for a catalog that came from the config option. An agent that describes each model's efforts
   * in `session/new` has answered already and is not asked again.
   *
   * No probe has to succeed. A model whose probe fails, or that the time does not reach, keeps the
   * session-wide efforts the catalog held before. `deadline` is when the caller's own `model/list`
   * times out: a sweep that ran past it would leave the user with no models at all, rather than with
   * imprecise efforts.
   */
  async #modelReasoningEfforts(
    connection: ClientSideConnection,
    probe: SessionSetupResponse & { sessionId: string },
    models: AcpModel[],
    deadline: number,
  ): Promise<AcpModel[]> {
    const option = (probe.configOptions ?? []).find(
      (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
        candidate.category === "model" && candidate.type === "select",
    );
    if (!option || availableModels(probe).length > 0) return models;
    // The sweep, and each request in it, ends at whichever comes first: its own budget, or the point
    // where the caller's deadline still holds the cleanup. One agent that never answers then costs
    // its own model's efforts, and not the whole catalog.
    const sweepEnd = Math.min(Date.now() + MODEL_REASONING_PROBE_BUDGET_MS, deadline - MODEL_REASONING_CLEANUP_MS);
    const probed: AcpModel[] = [];
    let selected = option.currentValue;
    for (const model of models) {
      const response = await this.#requestBefore(
        () => connection.setSessionConfigOption({ sessionId: probe.sessionId, configId: option.id, value: model.id }),
        Math.min(sweepEnd, Date.now() + MODEL_REASONING_PROBE_TIMEOUT_MS),
        "session/set_config_option",
      );
      if (response) selected = model.id;
      probed.push(response ? { ...model, ...reasoningFromConfig(response.configOptions) } : model);
    }
    // Back to the model the session opened on. The session is closed next, but an agent that keeps a
    // "last used model" outside the session would otherwise remember the end of this sweep, and the
    // user's own next CLI session would start on a model they never chose.
    if (selected !== option.currentValue) {
      await this.#requestBefore(
        () =>
          connection.setSessionConfigOption({
            sessionId: probe.sessionId,
            configId: option.id,
            value: option.currentValue,
          }),
        Math.min(Date.now() + MODEL_REASONING_CLEANUP_MS, deadline),
        "session/set_config_option",
      );
    }
    return probed;
  }

  /**
   * The thread a `thread/read` can answer from, loading the session when it is not held here.
   *
   * An ACP session lives in this process alone, so a restart leaves every persisted session id
   * unknown until something loads it. Boot recovery reads those ids before any turn does, and a
   * refusal there is reported to the user as a failed history backfill. The session is loaded
   * instead, which also leaves it warm for the first turn. `null` is answered when it cannot be
   * loaded - the agent does not support `session/load`, the caller sent no `cwd`, or the load
   * failed - because a read is advisory: its callers treat an absent turn as an unsettled one.
   */
  async #readableThread(id: string, params: unknown): Promise<AcpThread | null> {
    const held = this.#threads.get(id);
    if (held) return held;
    if (!getString(params, "cwd")) return null;
    // A resume that is already loading this session opens it for a turn, not for this read.
    const resuming = this.#startingThreads.has(id);
    try {
      await this.#ensureInitialized();
      if (!this.#loadsSessions) return null;
      await this.#startThread(params, true);
    } catch (error) {
      // The next turn replaces the missing session, so the user has nothing to act on.
      if (!(error instanceof MissingAcpSessionError)) {
        this.emit("diagnostic", this.#redact(`ACP session load for a read failed: ${String(error)}`));
      }
      return null;
    }
    const thread = this.#threads.get(id) ?? null;
    // Boot recovery reads every stored session, and each loaded session holds its own set of the
    // user's MCP servers. A session loaded only for a read is idle from the start, so the idle limit
    // counts it and keeps only the most recent ones warm for a first turn.
    if (thread && !resuming && thread.idleSince === 0 && !thread.activeTurn) this.#threads.markIdle(thread);
    return thread;
  }

  /** Whether the agent answers `session/load`, which it advertises in its initialization. */
  get #loadsSessions(): boolean {
    return this.#initialization?.agentCapabilities?.loadSession === true;
  }

  async #startThread(params: unknown, resume: boolean): Promise<{ thread: { id: string } }> {
    await this.#ensureInitialized();
    if (!this.#signedIn) throw new Error(this.options.signInMessage);
    const requestedThreadId = getString(params, "threadId");
    if (!resume || !requestedThreadId) return this.#openThread(params, false);
    const held = this.#threads.get(requestedThreadId);
    let turns: AcpThread["turns"] | undefined;
    // The MCP servers are fixed when a session opens, so a changed Computer Use switch loads the
    // session again. A session with a turn keeps its servers until a later resume.
    if (held && !held.activeTurn && held.computerUse !== computerUseParam(params)) {
      turns = held.turns;
      await this.#threads.close(held);
    }
    // A thread this client already holds takes the caller's settings even though no session is
    // opened for them: the loader may have been a `thread/read`, which carries none of its own, and
    // the turn that follows must not run on the settings of whoever loaded the session first.
    else if (held) {
      held.developerInstructions = getString(params, "developerInstructions") ?? held.developerInstructions;
      await this.#applyConfig(held, getString(params, "model"), getString(params, "effort"));
      return { thread: { id: requestedThreadId } };
    }
    // One load per session id, however many callers ask for it. Boot recovery reads a session while
    // the first drain resumes it, and two `session/load` calls would leave two threads and two MCP
    // bridge sessions under one id, of which only the last is reachable.
    const starting = this.#startingThreads.get(requestedThreadId);
    if (starting) return starting;
    const start = this.#openThread(params, true, turns).finally(() => {
      this.#startingThreads.delete(requestedThreadId);
    });
    this.#startingThreads.set(requestedThreadId, start);
    return start;
  }

  async #openThread(
    params: unknown,
    resume: boolean,
    heldTurns?: AcpThread["turns"],
  ): Promise<{ thread: { id: string } }> {
    const requestedThreadId = getString(params, "threadId");
    if (resume && requestedThreadId && !this.#loadsSessions) {
      // Reported as a missing session, which is what it is for the caller: the agent cannot give
      // this session back, so the recovery that replaces it runs now rather than after a protocol
      // error the user would have to read.
      throw new Error(`Unknown ACP session: ${requestedThreadId}`);
    }
    const cwd = requiredString(params, "cwd");
    const dynamicTools = getArray(params, "dynamicTools").filter(isDynamicToolNamespace);
    const computerUse = computerUseParam(params);
    let threadRef: AcpThread | null = null;
    const mcp = await this.#bridge.createSession(
      requestedThreadId ?? randomUUID(),
      dynamicTools,
      () => threadRef?.activeTurn?.id ?? null,
      (call, signal) => this.#callDynamicTool(call, signal),
    );
    try {
      const connection = this.#requireConnection();
      const additionalDirectories = getArray(params, "runtimeWorkspaceRoots").filter(isString);
      let id: string;
      let configOptions: SessionConfigOption[];
      let currentModelId: string | null;
      // OpenBot's bridge servers last: all providers key MCP servers by name, so a user
      // configuration that reached one of those names would take the agent's own tools away.
      const handoff = acpMcpServers(
        await usableMcpServers(
          agentMcpServers(this.options.mcpServers?.() ?? [], computerUse),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpAuthorization,
        ),
      );
      this.options.reportMcpDrops?.(this.provider, handoff.dropped);
      const mcpServers = [...handoff.servers, ...mcp.servers];
      if (resume && requestedThreadId) {
        const response = await this.#loadSession(connection, {
          sessionId: requestedThreadId,
          cwd,
          additionalDirectories,
          mcpServers,
        });
        id = requestedThreadId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      } else {
        const response = await connection.newSession({ cwd, additionalDirectories, mcpServers });
        id = response.sessionId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      }
      mcp.setThreadId(id);
      const thread: AcpThread = {
        id,
        cwd,
        developerInstructions: getString(params, "developerInstructions") ?? "",
        configOptions,
        currentModelId,
        mcp,
        activeTurn: null,
        turns: heldTurns ?? this.#threads.released(id)?.turns ?? [],
        dynamicTools,
        workspaceRoots: additionalDirectories,
        computerUse,
        idleRelease: null,
        idleSince: 0,
      };
      threadRef = thread;
      this.#threads.add(thread);
      await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));
      return { thread: { id } };
    } catch (error) {
      mcp.close();
      throw error;
    }
  }

  /**
   * An agent that follows the protocol answers a session missing from its store with `-32002`, the
   * resource-not-found error, naming the session. Cline does.
   *
   * OpenCode answers a session missing from its store with the same `-32603` "OpenCode service
   * failure" as a fault of its internal server. Only a `session/list` that answers in full without
   * the session shows it is missing: the caller then replaces it and hands it the transcript. A
   * session that is listed, a list that fails, or an OpenCode without `session/list` leaves the
   * session kept: one more attempt, then the fault is reported.
   */
  async #loadSession(connection: ClientSideConnection, request: LoadSessionRequest): Promise<LoadSessionResponse> {
    let failure: unknown;
    try {
      return await connection.loadSession(request);
    } catch (error) {
      if (isSessionNotFound(error, request.sessionId)) {
        throw new MissingAcpSessionError(`ACP session not found: ${request.sessionId}`, error);
      }
      if (this.provider !== "opencode" || !isOpenCodeServiceFailure(error)) throw error;
      failure = error;
    }
    const listing = await this.#sessionListing(connection, request);
    if (listing === "absent") {
      throw new MissingAcpSessionError(
        `OpenCode session not found: ${request.sessionId} (OpenCode service failure)`,
        failure,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, OPENCODE_LOAD_RETRY_MS));
    try {
      // The process can have stopped during the wait; this reports that instead of a closed stream.
      return await this.#requireConnection().loadSession(request);
    } catch (error) {
      if (!isOpenCodeServiceFailure(error)) throw error;
      throw new Error(sourceText("error.provider.opencodeServiceFailure"), { cause: error });
    }
  }

  /** Whether the agent's `session/list` for the session's directory holds the session. */
  async #sessionListing(
    connection: ClientSideConnection,
    request: LoadSessionRequest,
  ): Promise<"listed" | "absent" | "unknown"> {
    if (!this.#initialization?.agentCapabilities?.sessionCapabilities?.list) return "unknown";
    let cursor: string | undefined;
    try {
      for (let page = 0; page < OPENCODE_SESSION_LIST_PAGES; page += 1) {
        const response = await connection.listSessions({ cwd: request.cwd, ...(cursor ? { cursor } : {}) });
        if (response.sessions.some((session) => session.sessionId === request.sessionId)) return "listed";
        cursor = response.nextCursor ?? undefined;
        if (!cursor) return "absent";
      }
    } catch {
      return "unknown";
    }
    return "unknown";
  }

  async #applyConfig(thread: AcpThread, model: string | null, effort: string | null): Promise<void> {
    for (const [category, value] of [
      ["model", model],
      ["thought_level", effort],
    ] as const) {
      if (!value) continue;
      if (category === "thought_level" && thread.currentModelId) {
        const currentModel = this.#models.find((candidate) => candidate.id === thread.currentModelId);
        if (currentModel && currentModel.usesModelReasoningEffort !== null) {
          if (currentModel.usesModelReasoningEffort && currentModel.supportedReasoningEfforts.includes(value)) {
            await this.#requireConnection().request("session/set_model", {
              sessionId: thread.id,
              modelId: thread.currentModelId,
              _meta: { reasoningEffort: currentModel.reasoningEffortWireValues.get(value) ?? value },
            });
          }
          continue;
        }
      }
      const option = thread.configOptions.find(
        (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
          candidate.category === category && candidate.type === "select",
      );
      if (!option) {
        if (category === "model" && thread.currentModelId !== value) {
          await this.#requireConnection().request("session/set_model", {
            sessionId: thread.id,
            modelId: value,
          });
          thread.currentModelId = value;
        }
        continue;
      }
      // An effort travels by OpenBot's name, and the agent's own name for it is read from the option
      // this session published, not from the catalog: the session is the one that has to accept it.
      const values = selectValues(option);
      const wanted =
        category === "thought_level" ? reasoningEffortWireValues(values.map((entry) => entry.value)).get(value) : value;
      const selected = values.find((candidate) => candidate.value === wanted);
      if (!selected) continue;
      const response = await this.#requireConnection().setSessionConfigOption({
        sessionId: thread.id,
        configId: option.id,
        value: selected.value,
      });
      thread.configOptions = response.configOptions;
      if (category === "model") thread.currentModelId = selected.value;
    }
  }

  async #startTurn(
    params: unknown,
    steer: boolean,
  ): Promise<{ turn: { id: string; status: string }; turnId?: string }> {
    const threadId = requiredString(params, "threadId");
    return this.#threads.startTurn(threadId, () => this.#openTurn(threadId, params, steer));
  }

  async #openTurn(
    threadId: string,
    params: unknown,
    steer: boolean,
  ): Promise<{ turn: { id: string; status: string }; turnId?: string }> {
    await this.#threads.wake(threadId);
    const thread = this.#requireThread(threadId);
    if (!steer && thread.activeTurn) throw new Error("The ACP thread already has an active turn.");
    if (steer && !thread.activeTurn) throw new Error("The ACP thread has no active turn to steer.");
    await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));
    const activeTurn = thread.activeTurn;
    const turnId = steer && activeTurn ? activeTurn.id : (getString(params, "clientUserMessageId") ?? randomUUID());
    const blocks = await promptBlocks(params);
    if (!steer && thread.developerInstructions) {
      blocks.unshift({
        type: "text",
        text: `<openbot-developer-instructions>\n${thread.developerInstructions}\n</openbot-developer-instructions>`,
      });
    }
    this.#requireServedModel(thread);
    if (steer) {
      // A steered message can want an answer, so an empty turn is again a failure to report.
      if (activeTurn) activeTurn.answerOptional = false;
      // ACP has no steer request, and an agent can refuse a second prompt while one runs. The turn
      // then sends the refused prompt after the running one ends, so the message is not lost.
      void this.#requireConnection()
        .prompt({ sessionId: thread.id, prompt: blocks })
        .catch((error) => {
          if (activeTurn && thread.activeTurn === activeTurn) {
            activeTurn.deferredPrompts.push(blocks);
            return;
          }
          this.emit("diagnostic", this.#redact(`ACP steer failed: ${String(error)}`));
        });
      return { turn: { id: turnId, status: "inProgress" }, turnId };
    }
    const turn: AcpTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      thoughtItemId: `${turnId}:thought`,
      text: "",
      thought: "",
      thoughtStarted: false,
      receivedOutput: false,
      answerOptional: isRecord(params) && params.answerOptional === true,
      messages: [],
      toolNames: new Map(),
      toolKinds: new Map(),
      deferredPrompts: [],
      stopped: false,
      task: Promise.resolve(),
    };
    thread.activeTurn = turn;
    this.#threads.holdForTurn(thread);
    this.emit("notification", {
      method: "turn/started",
      params: { threadId: thread.id, turn: { id: turn.id, status: "inProgress" } },
    });
    turn.task = this.#consumePrompt(thread, turn, blocks);
    return { turn: { id: turn.id, status: "inProgress" } };
  }

  /** Refuses a prompt whose endpoint was taken out while this turn was prepared. */
  #requireServedModel(thread: AcpThread): void {
    const model = thread.currentModelId;
    if (!model || !this.options.servesModel) return;
    if (!this.options.servesModel(model)) {
      throw new Error(sourceText("error.agent.endpointRemoved"));
    }
  }

  async #consumePrompt(thread: AcpThread, turn: AcpTurn, prompt: ContentBlock[]): Promise<void> {
    try {
      let response = await this.#requireConnection().prompt({ sessionId: thread.id, prompt });
      for (;;) {
        if (response.usage)
          this.emit("notification", {
            method: "openbot/usage",
            params: { threadId: thread.id, turnId: turn.id, usage: response.usage },
          });
        const deferred = response.stopReason === "end_turn" && !turn.stopped ? turn.deferredPrompts.shift() : undefined;
        if (!deferred) break;
        // The reply to the earlier prompt is complete; the refused steer gets its own reply.
        this.#completeThought(thread, turn);
        this.#completeMessage(thread, turn, "final_answer");
        const answered = turn.receivedOutput;
        turn.receivedOutput = false;
        try {
          response = await this.#requireConnection().prompt({ sessionId: thread.id, prompt: deferred });
        } catch (error) {
          // The agent refused the steer again, so the earlier reply ends the turn.
          this.emit("diagnostic", this.#redact(`ACP steer failed: ${String(error)}`));
          turn.receivedOutput = answered;
          break;
        }
      }
      // OpenCode can swallow provider errors and report a successful, empty ACP turn.
      // Do not invent the upstream cause or report that turn as a successful reply. A turn told not
      // to answer ends empty on purpose, and an error there costs no answer the user waits for.
      if (
        this.provider === "opencode" &&
        response.stopReason === "end_turn" &&
        !turn.receivedOutput &&
        !turn.answerOptional
      ) {
        this.#completeTurn(
          thread,
          turn,
          "failed",
          "OpenCode returned no response. Check the selected model's sign-in and billing in OpenCode, then retry or choose another model.",
        );
        return;
      }
      const status =
        response.stopReason === "cancelled"
          ? "interrupted"
          : response.stopReason === "end_turn"
            ? "completed"
            : "failed";
      this.#completeTurn(thread, turn, status, status === "failed" ? response.stopReason : null);
    } catch (error) {
      this.#completeTurn(thread, turn, "failed", error);
    }
  }

  #sessionUpdate(notification: SessionNotification): void {
    const thread = this.#threads.get(notification.sessionId);
    if (!thread) return;
    const turn = thread.activeTurn;
    const update = notification.update;
    if (!turn) return;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      if (update.content.text) this.#completeThought(thread, turn);
      if (update.content.text.trim()) turn.receivedOutput = true;
      turn.text += update.content.text;
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      this.#completeMessage(thread, turn, "commentary");
      /* A delta carries no phase, so the item has to be opened as `commentary` first — otherwise the
         thought lands in an ordinary agentMessage and renders as a chat bubble. */
      if (!turn.thoughtStarted) {
        turn.thoughtStarted = true;
        this.emit("notification", {
          method: "item/started",
          params: {
            threadId: thread.id,
            turnId: turn.id,
            item: { id: turn.thoughtItemId, type: "agentMessage", phase: "commentary" },
          },
        });
      }
      turn.thought += update.content.text;
      this.emit("notification", {
        method: "item/agentMessage/delta",
        params: { threadId: thread.id, turnId: turn.id, itemId: turn.thoughtItemId, delta: update.content.text },
      });
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      turn.receivedOutput = true;
      if (update.sessionUpdate === "tool_call") this.#completeMessage(thread, turn, "commentary");
      // ACP updates are partial; OpenCode omits the name when a tool finishes.
      const name = update.name ?? update.title ?? turn.toolNames.get(update.toolCallId) ?? "tool";
      turn.toolNames.set(update.toolCallId, name);
      const toolKind = update.kind ?? turn.toolKinds.get(update.toolCallId) ?? "other";
      turn.toolKinds.set(update.toolCallId, toolKind);
      this.emit("notification", {
        method: update.status === "completed" || update.status === "failed" ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: {
            id: update.toolCallId,
            type: "toolCall",
            name,
            toolKind,
            status: update.status,
            arguments: update.rawInput,
            result: update.rawOutput,
          },
        },
      });
      return;
    }
    if (update.sessionUpdate === "plan") {
      this.emit("notification", {
        method: PLAN_UPDATED_METHOD,
        params: { threadId: thread.id, turnId: turn.id, explanation: null, plan: acpPlanSteps(update.entries) },
      });
    }
  }

  // ACP cannot identify final text while streaming. Buffer unclassified text privately,
  // publishing commentary at a later step boundary or an answer when the prompt finishes.
  #completeMessage(thread: AcpThread, turn: AcpTurn, phase: "commentary" | "final_answer"): void {
    if (!turn.text) return;
    const item = { id: turn.itemId, type: "agentMessage", phase, text: turn.text } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.text = "";
    turn.itemId = `${turn.id}:assistant:${turn.messages.length}`;
  }

  #completeThought(thread: AcpThread, turn: AcpTurn): void {
    if (!turn.thoughtStarted) return;
    const item = {
      id: turn.thoughtItemId,
      type: "agentMessage",
      phase: "commentary",
      text: turn.thought,
    } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.thought = "";
    turn.thoughtStarted = false;
    turn.thoughtItemId = `${turn.id}:thought:${turn.messages.length}`;
  }

  #completeTurn(thread: AcpThread, turn: AcpTurn, status: string, error: unknown): void {
    if (thread.activeTurn !== turn) return;
    this.#completeThought(thread, turn);
    this.#completeMessage(thread, turn, "final_answer");
    if (status === "failed" && error) {
      const detail = this.#redact(failureText(error));
      const message =
        this.provider === "opencode" &&
        // Google answers "API key not valid" (#1388).
        /invalid api key|api key not valid|unauthori[sz]ed|token refresh failed|authentication failed/i.test(detail)
          ? sourceText("error.provider.opencodeCredentialsRejected", {
              detail: shownFailureDetail(detail.replace(/^RequestError:\s*Internal error:\s*/u, "")),
            })
          : this.provider === "opencode" && isOpenCodeServiceFailure(error)
            ? sourceText("error.provider.opencodeServiceFailure")
            : this.#openCodeRequestFailure(error, detail);
      this.emit("notification", {
        method: "error",
        params: { threadId: thread.id, turnId: turn.id, message },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread.id, turn: { id: turn.id, status } },
    });
    thread.turns.push({ id: turn.id, status, items: turn.messages });
    thread.activeTurn = null;
    this.#threads.markIdle(thread);
  }

  /**
   * OpenCode retries a rate limit or a provider failure by itself. When it stops, it fails the prompt
   * with the provider's text behind `Internal error:`, so a billing refusal, a rate limit and an
   * offline computer all read as one failure of OpenBot, and the user could not tell whether
   * waiting helps (#1163). The kind comes first; the provider's own text follows it.
   */
  #openCodeRequestFailure(error: unknown, detail: string): string {
    if (this.provider !== "opencode" || !(error instanceof RequestError) || error.code !== -32603) return detail;
    const reason = error.message.replace(/^Internal error:\s*/u, "");
    // The usage notice reports an exhausted usage limit, and it reads the whole text to find one.
    if (isUsageLimitDiagnostic(reason)) return detail;
    const key = OPENCODE_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
    if (!key) return detail;
    return sourceText(key, { detail: shownFailureDetail(this.#redact(reason)) });
  }

  async #requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.options.profileGeneration) return { outcome: { outcome: "cancelled" } };
    const thread = this.#threads.get(params.sessionId);
    const turnId = thread?.activeTurn?.id ?? randomUUID();
    const kind =
      params.toolCall.kind === "execute"
        ? "command"
        : ["edit", "delete", "move"].includes(params.toolCall.kind ?? "")
          ? "file-change"
          : "permissions";
    const requestedPermissions = kind === "permissions" ? { [params.toolCall.kind ?? "file-system"]: true } : null;
    const result = await this.#serverRequests.call(
      `item/${kind === "command" ? "commandExecution" : kind === "file-change" ? "fileChange" : "permissions"}/requestApproval`,
      {
        threadId: params.sessionId,
        turnId,
        command: params.toolCall.kind === "execute" ? printableInput(params.toolCall.rawInput) : null,
        reason: params.toolCall.title ?? null,
        permissions: requestedPermissions,
        acpOptions: params.options,
      },
    );
    const accepted =
      isRecord(result) &&
      (result.decision === "accept" ||
        result.decision === "approved" ||
        (isRecord(result.permissions) && Object.keys(result.permissions).length > 0));
    const option = bestPermissionOption(params.options, accepted);
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  async #requestUserInput(method: string, params: DynamicRecord): Promise<DynamicRecord> {
    const sessionId = getString(params, "sessionId") ?? [...this.#threads.ids()][0];
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    const result = await this.#serverRequests.call("item/tool/requestUserInput", {
      ...params,
      threadId: sessionId,
      turnId: thread?.activeTurn?.id ?? randomUUID(),
      sourceMethod: method,
    });
    return isRecord(result) ? result : {};
  }

  async #createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    const schema = getRecord(params, "requestedSchema");
    const properties = getRecord(schema, "properties") ?? {};
    const questions = Object.entries(properties).flatMap(([id, rawProperty]) => {
      if (!isRecord(rawProperty)) return [];
      const property = rawProperty;
      return [
        {
          id,
          header: getString(property, "title") ?? id,
          question: getString(property, "description") ?? getString(params, "message") ?? "ACP needs more information.",
          isSecret: secretElicitationField(id, property),
          options: elicitationOptions(property),
        },
      ];
    });
    if (questions.length === 0) {
      questions.push({
        id: "response",
        header: "ACP",
        question: getString(params, "message") ?? "ACP needs confirmation.",
        isSecret: false,
        options: null,
      });
    }
    const result = await this.#requestUserInput("session/elicitation", { ...params, questions });
    const answers = isRecord(result.answers) ? result.answers : null;
    if (!answers) return { action: "decline" };
    const content: Record<string, ElicitationContentValue> = {};
    for (const [id, answerValue] of Object.entries(answers)) {
      const answer = isRecord(answerValue) ? getArray(answerValue, "answers").filter(isString) : [];
      if (answer.length === 0) continue;
      content[id] = elicitationValue(isRecord(properties[id]) ? properties[id] : undefined, answer);
    }
    return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "decline" };
  }

  async #callDynamicTool(
    params: {
      threadId: string;
      turnId: string;
      callId: string;
      namespace: string;
      tool: string;
      arguments: unknown;
    },
    signal: AbortSignal,
  ): Promise<DynamicToolResult> {
    const result = await this.#serverRequests.call("item/tool/call", params, signal);
    if (!isDynamicToolResult(result)) throw new Error("OpenBot returned an invalid dynamic tool result.");
    return result;
  }

  #requireThread(id: string): AcpThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown ACP session: ${id}`);
    return thread;
  }

  #requireConnection(): ClientSideConnection {
    if (!this.#connection) throw new Error("ACP connection is not running.");
    return this.#connection;
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;
    if (!this.#stopping) this.emit("exit", error);
  }
}

/** Ends the agent process with SIGTERM, and with SIGKILL when it is still running after 2 seconds. */
async function endProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.end();
  // A `.cmd` agent runs under `cmd.exe`; a kill of the wrapper alone leaves the agent running.
  if (process.platform === "win32") return stopWindowsProcessTree(child);
  await new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function isDynamicToolNamespace(value: unknown): value is DynamicToolNamespace {
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

interface SessionSetupResponse {
  configOptions?: SessionConfigOption[] | null;
  models?: unknown;
}

function modelsFromSessionSetup(response: SessionSetupResponse): AcpModel[] {
  const options = sessionConfigOptions(response);
  const discovered = availableModels(response);
  if (discovered.length === 0) return modelsFromConfig(options);
  const configReasoning = reasoningFromConfig(options);
  return discovered.map((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts ?? configReasoning.supportedReasoningEfforts;
    const reasoningEffortWireValues = model.reasoningEffortWireValues;
    const defaultReasoningEffort =
      model.defaultReasoningEffort && supportedReasoningEfforts.includes(model.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : supportedReasoningEfforts.includes(configReasoning.defaultReasoningEffort)
          ? configReasoning.defaultReasoningEffort
          : (supportedReasoningEfforts[0] ?? "medium");
    return {
      id: model.id,
      name: model.name,
      description: model.description ?? "Model discovered from ACP CLI through ACP.",
      defaultReasoningEffort,
      supportedReasoningEfforts,
      reasoningEffortWireValues:
        reasoningEffortWireValues && reasoningEffortWireValues.size > 0
          ? reasoningEffortWireValues
          : configReasoning.reasoningEffortWireValues,
      usesModelReasoningEffort: model.usesModelReasoningEffort,
    };
  });
}

function modelsFromConfig(options: SessionConfigOption[]): AcpModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
  if (!model) return [];
  const reasoning = reasoningFromConfig(options);
  return selectValues(model).map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description ?? "Model discovered from ACP CLI through ACP.",
    ...reasoning,
    usesModelReasoningEffort: null,
  }));
}

function reasoningFromConfig(
  options: SessionConfigOption[],
): Pick<AcpModel, "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortWireValues"> {
  const thought = options.find((option) => option.category === "thought_level" && option.type === "select");
  const wireValues = reasoningEffortWireValues(
    thought && thought.type === "select" ? selectValues(thought).map((option) => option.value) : ["medium"],
  );
  const supported = [...wireValues.keys()];
  const currentEffort =
    thought && thought.type === "select" ? (normalizeEffort(thought.currentValue) ?? "medium") : "medium";
  return {
    defaultReasoningEffort: supported.includes(currentEffort) ? currentEffort : (supported[0] ?? "medium"),
    supportedReasoningEfforts: supported.length > 0 ? supported : ["medium"],
    reasoningEffortWireValues: wireValues.size > 0 ? wireValues : new Map([["medium", "medium"]]),
  };
}

function sessionConfigOptions(response: SessionSetupResponse): SessionConfigOption[] {
  return response.configOptions ?? [];
}

function currentModelFromSessionSetup(response: SessionSetupResponse): string | null {
  if (!isRecord(response.models)) return null;
  return isString(response.models.currentModelId) && response.models.currentModelId.trim()
    ? response.models.currentModelId.trim()
    : null;
}

function availableModels(response: SessionSetupResponse): Array<{
  id: string;
  name: string;
  description: string | null;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[] | null;
  reasoningEffortWireValues: Map<string, string> | null;
  usesModelReasoningEffort: boolean | null;
}> {
  if (!isRecord(response.models) || !Array.isArray(response.models.availableModels)) return [];
  const seen = new Set<string>();
  return response.models.availableModels.flatMap((value) => {
    if (!isRecord(value) || !isString(value.modelId) || !value.modelId.trim()) return [];
    const id = value.modelId.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    const metadata = isRecord(value._meta) ? value._meta : null;
    const reasoningEffortValues = Array.isArray(metadata?.reasoningEfforts)
      ? metadata.reasoningEfforts.filter(isRecord).flatMap((effort) => (isString(effort.value) ? [effort.value] : []))
      : null;
    const wireValues = reasoningEffortValues ? reasoningEffortWireValues(reasoningEffortValues) : null;
    const supportedReasoningEfforts = wireValues ? [...wireValues.keys()] : null;
    const usesModelReasoningEffort =
      metadata?.supportsReasoningEffort === false
        ? false
        : metadata?.supportsReasoningEffort === true || (supportedReasoningEfforts?.length ?? 0) > 0
          ? true
          : null;
    return [
      {
        id,
        name: isString(value.name) && value.name.trim() ? value.name.trim() : id,
        description: isString(value.description) && value.description.trim() ? value.description.trim() : null,
        defaultReasoningEffort:
          metadata && isString(metadata.reasoningEffort) ? normalizeEffort(metadata.reasoningEffort) : null,
        supportedReasoningEfforts:
          metadata?.supportsReasoningEffort === false
            ? ["medium"]
            : supportedReasoningEfforts && supportedReasoningEfforts.length > 0
              ? supportedReasoningEfforts
              : null,
        reasoningEffortWireValues: wireValues,
        usesModelReasoningEffort,
      },
    ];
  });
}

function selectValues(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

/**
 * What OpenBot's effort names are sent as, keyed by the OpenBot name.
 *
 * The exact name wins over an alias, whichever comes first. OpenCode offers
 * `["minimal", "low", "medium", "high", "xhigh"]`, where `minimal` also reads as low effort: first
 * value per key would make OpenBot's `low` send `minimal`, and a user who asks for low effort would
 * silently get the lowest one the model has. An alias is still kept for a key the agent has no exact
 * name for, which is how a model with `minimal` and no `low` stays reachable.
 */
function reasoningEffortWireValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeEffort(value);
    if (!normalized) continue;
    const held = result.get(normalized);
    // `value.toLowerCase()` and not the normalized form of it: an exact name is the agent's own
    // spelling of the key, and every key OpenBot has is one word.
    if (held === undefined || (held !== normalized && value.toLowerCase() === normalized)) {
      result.set(normalized, value);
    }
  }
  return result;
}

function normalizeEffort(value: string): string | null {
  const normalized = value.toLowerCase().replaceAll("-", "_");
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (["minimal", "none", "off"].includes(normalized)) return "low";
  if (["extra_high", "very_high"].includes(normalized)) return "xhigh";
  return null;
}

async function promptBlocks(params: unknown): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) blocks.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path)) {
      blocks.push({ type: "text", text: `Attached local file: ${item.path}` });
    }
    if (item.type === "localImage" && isString(item.path)) {
      const data = await readFile(item.path);
      blocks.push({ type: "image", data: data.toString("base64"), mimeType: imageMimeType(item.path), uri: item.path });
    }
  }
  return blocks;
}

function imageMimeType(path: string): "image/jpeg" | "image/webp" | "image/png" {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "image/png";
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function printableInput(value: unknown): string | null {
  if (isString(value)) return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function bestPermissionOption(options: PermissionOption[], accepted: boolean): PermissionOption | null {
  const kinds = accepted ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  return kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0] ?? null;
}

function isDynamicToolResult(value: unknown): value is DynamicToolResult {
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

/** A session that the agent does not have, so the caller opens a new one. */
class MissingAcpSessionError extends Error {
  constructor(message: string, cause: unknown) {
    // The wording is what `isMissingProviderSessionError` recognizes.
    super(message, { cause });
    this.name = "MissingAcpSessionError";
  }
}

/** The protocol's resource-not-found error, for this session. */
function isSessionNotFound(error: unknown, sessionId: string): boolean {
  if (!(error instanceof RequestError) || error.code !== -32002) return false;
  const uri = isRecord(error.data) ? error.data.uri : undefined;
  return uri === sessionId || error.message.includes(sessionId);
}

/**
 * The text of a failed turn. When a handler in an ACP agent throws, the SDK answers `Internal error`
 * and puts the thrown message in `data.details`, which `String(error)` leaves out (#1193).
 */
function failureText(error: unknown): string {
  if (!(error instanceof RequestError) || !isRecord(error.data)) return String(error);
  const details = error.data.details;
  return typeof details === "string" && details && !error.message.includes(details)
    ? `${String(error)}: ${details}`
    : String(error);
}

/**
 * OpenCode's wrapper error for a failed call to its internal server. It carries no cause: OpenCode
 * maps each such failure that is not an authentication error to this one.
 */
function isOpenCodeServiceFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32603 && /\bOpenCode service failure\b/.test(error.message);
}

const OPENCODE_FAILURE_DETAIL_LIMIT = 200;

/** The provider's text after a failure kind. The renderer shows its generic sentence for text over 400 characters. */
function shownFailureDetail(text: string): string {
  const characters = Array.from(text);
  return characters.length > OPENCODE_FAILURE_DETAIL_LIMIT
    ? `${characters.slice(0, OPENCODE_FAILURE_DETAIL_LIMIT - 1).join("")}…`
    : characters.join("");
}

/**
 * The kind of a model request that OpenCode gave up on, first match wins. A provider gateway
 * reports each kind as `Upstream request failed: <reason>`, so billing and the rate limit come
 * first. The provider's own failure comes before the network: a gateway that could not reach its
 * model was reached by this computer. Text that names no kind, such as OpenCode's own "Free usage
 * exceeded, subscribe to Go", is shown as it is.
 */
const OPENCODE_REQUEST_FAILURES = [
  [
    "error.provider.opencodeBilling",
    /\bno payment method\b|\binsufficient (?:account )?(?:funds|balance)\b|\bpayment required\b/iu,
  ],
  ["error.provider.opencodeRateLimited", /\brate[ _-]?limit|\btoo many requests\b/iu],
  [
    "error.provider.opencodeProviderFailed",
    /\binternal server error\b|\bservice unavailable\b|\bendpoint is unavailable\b|\bbad gateway\b|\bgateway time-?out\b|\boverloaded\b|\bupstream request failed\b/iu,
  ],
  [
    "error.provider.opencodeNetwork",
    /\b(?:cannot|unable to|could not) connect\b|\bfetch failed\b|\bfailed to fetch\b|\bgetaddrinfo\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b|\bsocket hang up\b/iu,
  ],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

function isAuthenticationError(error: unknown): boolean {
  return /auth|login|credential|token|unauthori[sz]ed|api key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
