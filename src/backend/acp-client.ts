import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ClientSideConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer,
  type PermissionOption,
  type PromptResponse,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import type { AgentSessionSettingsSnapshot, AgentSessionSettingValue, McpServerConfig } from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { type CauseCode, classifyFailure, httpStatusCause, structuredCause } from "@openbot/telemetry";
import { classifyUserError } from "@openbot/user-errors";
import { Deferred, Effect, Exit, Fiber, Option, Result, Scope, Semaphore } from "effect";
import { AcpConfiguration, type AcpModel, currentModelFromSessionSetup } from "./acp-configuration";
import { AcpConnection, type AcpConnectionOptions } from "./acp-connection";
import type { AcpCustomEndpoint, AcpFlavor, AcpMcpServerFailure, AcpRetryCause } from "./acp-flavor";
import {
  foldAcpSubagentTool,
  foldOpenCodeChildUpdate,
  markOpenCodeBackground,
  noteOpenCodeLaunch,
  OPENCODE_CHILD_SESSION_UPDATES,
  OPENCODE_CHILD_UPDATE_METHOD,
  type OpenCodeLaunches,
} from "./agent/acp-subagent-updates";
import {
  BACKGROUND_WAKE_NOTE,
  isTurnContextBlock,
  SELF_WAKE_NOTE,
  withoutTurnContext,
} from "./agent/developer-instructions";
import type { GeneratedMediaKind } from "./agent/image-generation";
import { acpPlanSteps, PLAN_UPDATED_METHOD } from "./agent/plan-updates";
import { elicitationFieldQuestions, elicitationValue } from "./agent/prompts";
import {
  isMcpSessionClosingDiagnostic,
  MCP_PROVIDER_FAILURE_TEXT,
  mcpProviderFailureKind,
} from "./agent/provider-diagnostics";
import { ROUTINE_NO_UPDATE_TOOL } from "./agent/routine-quiet-runs";
import {
  endSubagentTurn,
  newSubagentState,
  SUBAGENTS_UPDATED_METHOD,
  type SubagentChange,
  stopSubagents,
} from "./agent/subagent-updates";
import { visibleDynamicTools, withCatalogTools, withChannelTools } from "./agent/tool-catalog";
import { TurnContext } from "./agent/turn-context";
import {
  AgentProcessExitError,
  type AgentProvider,
  type DiagnosticOrigin,
  ProviderSessionBusyError,
  ProviderTurnActiveError,
} from "./agent-client";
import { type AgentCliInfo, cliPathEnvironment, compareReleases, isVersion, olderVersion } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import { encodedModelId, providerModelValue } from "./encoded-model-id";
import { IdleThreadPool } from "./idle-thread-pool";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import type { McpToolArguments } from "./mcp-probe";
import {
  type AcpMcpServer,
  acpMcpServerName,
  acpMcpServers,
  agentMcpServers,
  computerUseParam,
  type McpDropReporter,
  type McpEndpointSource,
  type McpServerSource,
  type McpToolRuntimeSource,
  mcpAgentParam,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { type RelayedMcpToolOutcome, type StdioMcpRelay, startStdioMcpRelay } from "./mcp-stdio-relay";
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
  PROVIDER_STOPPED_WAITING,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";
import {
  type ProviderClientOperationError,
  ProviderSignInError,
  providerCall,
  providerFailure,
  providerResult,
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
import { TimeoutError } from "./with-timeout";

const logger = createOpenBotLogger("acp-client");

const RESTORE_LIST_RETRY_MS = 500;

const RESTORE_START_RETRY_MS = 2_000;

const SESSION_SIGN_IN_RETRY_MS = 2_000;

const SESSION_LIST_PAGES = 50;

const UNCLAIMED_MCP_FAILURE_MS = 60_000;
const UNCLAIMED_MCP_FAILURE_LIMIT = 50;

const ACP_HISTORY_REPLAY_QUEUE_LIMIT = 256;

const ACP_PROMPT_AUDIO_BASE64_BYTES = 19 * 1024 * 1024;

const ACP_TURN_STALL_MS = 5 * 60_000;

const ACP_MODEL_RETRY_GRACE = 1.2;

const ACP_FIRST_UPDATE_MS = 3 * 60_000;

const MCP_TOOL_CALL_ANSWER_MARGIN_MS = 15_000;

const SILENT_PROMPT = Symbol("silent prompt");

const SESSION_STATE_UPDATES: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set([
  "available_commands_update",
  "current_mode_update",
  "session_info_update",
  "user_message_chunk",
]);

const MODEL_RETRY_STATUS = {
  unreachable: "status.provider.modelRetryUnreachable",
  outOfMemory: "status.provider.modelRetryOutOfMemory",
  serverError: "status.provider.modelRetryServerError",
} as const satisfies Record<AcpRetryCause, keyof SourceMessages>;

const ACP_STOP_GRACE_MS = 10_000;

const ACP_REPEATED_TOOL_FAILURES = 5;

const ACP_STEER_ANSWER_MS = 3_000;

const ACP_MCP_LIST_MARGIN_MS = 1_000;

const ACP_THROWAWAY_DELETE_MS = 3_000;

const ACP_BACKGROUND_POLL_MS = 2_000;

const ACP_BACKGROUND_WATCH_MS = 30 * 60_000;

const ACP_WORK_HOLD_POLL_MS = 60_000;

const ACP_WORK_HOLD_MAX_MS = 4 * 60 * 60_000;

const ACP_WORK_HOLD_QUIET_RELEASE_MS = 10 * 60_000;

const ACP_BACKGROUND_TURN_QUIET_MS = 15_000;

const ACP_STOPPED_OUTPUT_MS = 30_000;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

interface AcpTurn {
  id: string;
  startedAt: number;
  itemId: string;
  thoughtItemId: string;
  text: string;
  thought: string;
  thoughtStarted: boolean;
  receivedOutput: boolean;
  reasoned: boolean;
  showedPlanOrCompaction: boolean;
  interruptedAnswer: string | null;
  providerError: string | null;
  signInLost: boolean;
  failureCause: CauseCode | null;
  accountLink: string | null;
  sessionLost: boolean;
  sdkFailureAt: number | null;
  retryNotices: string;
  textToolCallAt: number | null;
  answerPaused: boolean;
  answerOptional: boolean;
  messages: ThreadItem[];
  toolNames: Map<string, string>;
  toolKinds: Map<string, string>;
  mediaKinds: Map<string, GeneratedMediaKind>;
  toolItems: Map<string, ThreadItem>;
  approvedEdits: { id: string; paths: readonly string[] }[];
  approvedEditRuns: Map<string, string>;
  approvedEditsRan: Set<string>;
  repeatedFailure: { key: string; count: number } | null;
  quietNoUpdate: boolean;
  stopped: boolean;
  readonly stop: AbortController;
  completing: boolean;
  task: Fiber.Fiber<void, ProviderClientOperationError> | null;
  readonly steerReplies: Deferred.Deferred<Result.Result<PromptResponse, ProviderClientOperationError>>[];
  lastPrompt: Deferred.Deferred<void> | null;
  readonly steerLock: Semaphore.Semaphore;
  lastActivityAt: number;
  modelRetries: number;
  answered: boolean;
  retrying?: "agent" | "model";
  waitingOnUser: number;
  abandoned: boolean;
  reportedCost: number | null;
  unprompted: boolean;
  textMessageId: string | null;
  textMessageStart: number;
  messageChunks: number;
  lastChunkAt: number | null;
  wake: boolean;
  beforeWakeEcho: SessionUpdate[] | null;
}

type AcpSessionRestore = Omit<LoadSessionRequest, "sessionId">;

interface SharedStdioRelay {
  launch: string;
  relay: Deferred.Deferred<StdioMcpRelay, ProviderClientOperationError>;
  replaced: Deferred.Deferred<StdioMcpRelay, ProviderClientOperationError>[];
  users: number;
}

interface RelayedMcpServers {
  own: readonly string[];
  byName: ReadonlyMap<string, StdioMcpRelay>;
}

interface AcpThread {
  id: string;
  cwd: string;
  developerInstructions: string;
  instructionsSent: string | null;
  contextUsed: number | null;
  promptsSinceInstructions: number;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  mcp: LocalMcpSession;
  mcpListed: boolean;
  relays: Effect.Effect<void>;
  relayed: RelayedMcpServers;
  activeTurn: AcpTurn | null;
  needsResume: boolean;
  transport: AcpConnection | null;
  dynamicTools: DynamicToolNamespace[];
  workspaceRoots: string[];
  computerUse: boolean;
  agentId: string | null;
  idleRelease: ReturnType<typeof setTimeout> | null;
  idleSince: number;
  restore: AcpSessionRestore;
  shownIds: Set<string>;
  backgroundUntil: number;
  backgroundUpdatedAt: string | null;
  backgroundSkipUntil: number;
  backgroundReplay: Deferred.Deferred<void> | null;
  workHold: { since: number; changedAt: number } | null;
  leftOutMcpServers: Map<McpServer, string>;
  throwaway: boolean;
}

type ReleasedAcpThread = Pick<
  AcpThread,
  | "cwd"
  | "developerInstructions"
  | "dynamicTools"
  | "workspaceRoots"
  | "computerUse"
  | "agentId"
  | "instructionsSent"
  | "contextUsed"
  | "promptsSinceInstructions"
>;

export interface AcpHistoryPersistence {
  readonly read?: ReadProviderHistory;
  readonly complete?: (request: ProviderHistoryRequest) => Effect.Effect<boolean, ProviderClientOperationError>;
  readonly append?: (
    threadId: string,
    fragment: ProviderHistoryFragment,
  ) => Effect.Effect<void, ProviderClientOperationError>;
}

const ACP_SESSION_IDLE_RELEASE_MS = 5 * 60_000;

const ACP_SESSION_PROCESS_START_TIMEOUT_MS = 180_000;

const ACP_INSTRUCTIONS_REFRESH_PROMPTS = 10;

const SLASH_COMMAND = /^\/[^\s/]+(?:\s|$)/u;

const ACP_COMPACTION_CONTEXT_RATIO = 0.6;

const ACP_IDLE_SESSION_LIMIT = 1;

interface AcpProviderAccount {
  email: string | null;
  planType: string | null;
}

interface HistoryReplay {
  readonly consume: ProviderHistoryConsumer;
  readonly items: "none" | "full";
  readonly itemsById: Map<string, ThreadItem>;
  readonly queue: ProviderHistoryFragment[];
  readonly controller: AbortController;
  currentTurnId: string | null;
  currentUserMessageId: string | null;
  currentUserItemId: string | null;
  currentAgentItemId: string | null;
  turnHasOutput: boolean;
  turnSequence: number;
  currentTurnStartedAt: number | undefined;
  hasUpdates: boolean;
  stopped: boolean;
  sourceDone: boolean;
  draining: boolean;
  done: Promise<void>;
  resolveDone: () => void;
  ended: Promise<void>;
  pending: number;
  error: unknown;
}

export const OPENBOT_ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  elicitation: { form: {} },
  session: { configOptions: { boolean: {} } },
} as const;

export const OPENBOT_ACP_CLIENT_INFO = { name: "openbot", title: "OpenBot", version: "0.1.0" } as const;

export interface AcpSavedSignInCheck {
  refusedAfterEmptyAnswer(model: string | null): Effect.Effect<"lasting" | "turn" | null>;
  refusedAtStart(): Effect.Effect<boolean>;
}

export interface AcpProviderOptions {
  provider: AgentProvider;
  history?: AcpHistoryPersistence | undefined;
  label?: string;
  flavor: AcpFlavor;
  allowNoModels?: boolean;
  noModelsWhenSignedOut?: boolean;
  discoveryCwd?: () => string;
  additionalModels?: () => Effect.Effect<AcpModel[]>;
  modelName?: (id: string, name: string) => string;
  encodesModelIds?: boolean;
  customEndpoint?: (modelId: string | null) => AcpCustomEndpoint | null;
  savedKey?: (modelId: string | null) => boolean;
  providerKeyStored?: (provider: string) => boolean;
  providerRefusalStatus?: (sessionId: string) => number | null;
  redactValues?: () => readonly string[];
  profileGeneration?: boolean;
  mediaGeneration?: boolean;
  argv: readonly string[];
  env: Record<string, string>;
  extraEnv?: () => Record<string, string>;
  confine?(target: SpawnTarget): SpawnTarget;
  privateTemp?: AcpConnectionOptions["privateTemp"];
  signInMessage: string;
  servesModel?: ((modelId: string) => boolean) | undefined;
  mcpServers?: McpServerSource | undefined;
  turnStallMs?: number;
  firstUpdateMs?: number;
  reportMcpDrops?: McpDropReporter | undefined;
  mcpToolRuntimes?: McpToolRuntimeSource | undefined;
  mcpEndpoint?: McpEndpointSource | undefined;
  authenticate?(
    connection: ClientSideConnection,
    initialization: InitializeResponse,
  ): Effect.Effect<void, ProviderClientOperationError>;
  savedKeyRefusedMessage?: () => string | null;
  savedKeyLimitMessage?: (detail: string, error?: unknown) => string | null;
  authBlockedMessage?: () => string | null;
  savedSignInCheck?: AcpSavedSignInCheck;
  readAccount?(
    connection: ClientSideConnection,
  ): Effect.Effect<Partial<AcpProviderAccount>, ProviderClientOperationError>;
  readRateLimits?(
    connection: ClientSideConnection,
    model: string | null,
  ): Effect.Effect<AccountRateLimitsReadResult, ProviderClientOperationError>;
  steer?(
    connection: ClientSideConnection,
    message: { sessionId: string; messageId: string | null; blocks: ContentBlock[] },
  ): Effect.Effect<void, ProviderClientOperationError>;
  steers?(initialization: InitializeResponse): boolean;
}

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  get contextCompaction(): "handoff" | "unsupported" {
    return this.#flavor.contextCompaction ?? "unsupported";
  }
  get compactsItself(): boolean {
    return this.#flavor.compactsItself === true;
  }
  get provisionalAnswers(): boolean {
    return this.#flavor.streamAnswerBeforePromptReturns === true && !this.#flavor.promptOpenForBackgroundTasks;
  }
  get provider(): AgentProvider {
    return this.options.provider;
  }
  readonly mcpToolsFixedAtStart = (): boolean => this.#flavor.mcpToolsFixedAtStart === true;
  readonly catalogAsMcpTools = (): boolean => this.#flavor.catalogAsMcpTools === true;
  readonly imageInput = (): boolean => this.#initialization?.agentCapabilities?.promptCapabilities?.image === true;
  readonly turnContext = true;
  readonly #turnContext = new TurnContext();
  readonly #flavor: AcpFlavor;
  readonly #transport: AcpConnection;
  readonly #configuration: AcpConfiguration;
  readonly #requestTimeoutMs: number;
  readonly #cli: AgentCliInfo;
  #probing = false;
  #promptAnswered = false;
  readonly #bridge = new LocalMcpBridge();
  readonly #sharedRelays = new Map<string, SharedStdioRelay>();
  #unclaimedMcpFailures: Array<AcpMcpServerFailure & { at: number }> = [];
  readonly #closedSessions = new Map<string, number>();
  readonly #threads = new IdleThreadPool<AcpThread, ReleasedAcpThread>({
    scope: () => this.#scope,
    releaseAfterMs: ACP_SESSION_IDLE_RELEASE_MS,
    idleLimit: ACP_IDLE_SESSION_LIMIT,
    canRelease: (thread) =>
      this.#loadsSessions &&
      (thread.transport !== null || this.#closesSessions) &&
      thread.backgroundUntil === 0 &&
      thread.workHold === null,
    snapshot: ({
      cwd,
      developerInstructions,
      dynamicTools,
      workspaceRoots,
      computerUse,
      agentId,
      instructionsSent,
      contextUsed,
      promptsSinceInstructions,
    }) => ({
      cwd,
      developerInstructions,
      dynamicTools,
      workspaceRoots,
      computerUse,
      agentId,
      instructionsSent,
      contextUsed,
      promptsSinceInstructions,
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
          openbotAgentId: released.agentId ?? undefined,
        },
        true,
      ),
  });
  readonly #startingThreads = new Map<
    string,
    Deferred.Deferred<{ thread: { id: string } }, ProviderClientOperationError>
  >();
  readonly #openingSessionProcesses = new Set<AcpConnection>();
  readonly #historyReplays = new Map<string, HistoryReplay>();
  readonly #backgroundReplays = new Map<string, SessionUpdate[]>();
  readonly #openingTurns = new Map<string, number>();
  #privateSession: { connection: ClientSideConnection; sessionId: string } | null = null;
  #privateAnswer: string[] | null = null;
  readonly #privatePromptLock = Semaphore.makeUnsafe(1);
  readonly #serverRequests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #openQuestionToolCalls = new Map<string, AbortController>();
  #initialized: Deferred.Deferred<void, ProviderClientOperationError> | null = null;
  #scope = Scope.makeUnsafe();
  #initialization: InitializeResponse | null = null;
  #startTimeoutMs: number | null = null;
  #models: AcpModel[] = [];
  #lastTurnStartedAt = 0;
  #signedIn = false;
  readonly #subagents = newSubagentState();
  readonly #subagentThreads = new Map<string, string>();
  readonly #openCodeLaunches: OpenCodeLaunches = new Map();
  readonly #selfWakes = new WeakMap<AcpThread, { left: number; until: number }>();

  constructor(
    cli: AgentCliInfo,
    requestTimeoutMs = 30_000,
    private readonly options: AcpProviderOptions,
  ) {
    super();
    this.#flavor = options.flavor;
    this.#cli = cli;
    this.#transport = this.#newTransport((error) => {
      this.#stopSubagents();
      this.emit("exit", error);
    });
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#configuration = new AcpConfiguration({
      connection: () => this.#requireConnection(),
      scope: () => this.#scope,
      label: () => this.#label,
      provider: options.provider,
      requestTimeoutMs,
      discoveryCwd: options.discoveryCwd,
      processWideModel: options.flavor.processWideModel === true,
      setsConfigOnlyOnChange: options.flavor.setsConfigOnlyOnChange === true,
      modelSetUnsaved: options.flavor.modelSetUnsaved,
      modelConfigId: options.flavor.modelConfigId,
      configSetUnsaved: options.flavor.configSetUnsaved,
      keepProbeSession: () => options.flavor.closeKeepsSession === true && this.#supportsSessionResume,
      probeCloseDelayMs: options.flavor.probeCloseDelayMs,
      deletesSessions: () => this.#deletesSessions,
      effortCategories: options.flavor.effortCategories,
    });
  }

  #newTransport(exit: (error: Error) => void): AcpConnection {
    return new AcpConnection({
      provider: this.options.provider,
      cli: this.#cli,
      argv: this.options.argv,
      env: this.options.env,
      extraEnv: this.options.extraEnv,
      confine: this.options.confine,
      privateTemp: this.options.privateTemp,
      label: () => this.#label,
      redact: (text) => this.#redact(text),
      diagnostic: (message, origin) => {
        const failedSession = this.options.flavor.sdkHarness?.failedSession(message);
        const failedTurn = failedSession ? this.#threads.get(failedSession)?.activeTurn : undefined;
        if (failedTurn && failedTurn.sdkFailureAt === null) failedTurn.sdkFailureAt = failedTurn.text.length;
        this.emit("diagnostic", message, origin);
      },
      exit,
      client: () => ({
        requestPermission: (params) => runCauseEffect(this.#requestPermission(params)),
        sessionUpdate: (params) => this.#sessionUpdate(params),
        createElicitation: (params) => runCauseEffect(this.#createElicitation(params)),
        extMethod: (method, params) => runCauseEffect(this.#requestUserInput(method, params)),
        extNotification: (method, params) => this.#extNotification(method, params),
      }),
    });
  }

  readonly readHistory = Effect.fn("AcpAgentClient.readHistory")(function* (
    this: AcpAgentClient,
    request: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const history = this.options.history;
    const reader = history?.read;
    const append = history?.append;
    const stored = request.providerOnly ? undefined : reader;
    const complete = history?.complete;
    if (request.providerOnly && complete && (yield* complete(request))) return;
    const durableReplay = append && reader;
    let storedStopped = false;
    const readStored = (storedRequest: ProviderHistoryRequest) =>
      reader
        ? reader(storedRequest, (fragment) =>
            consume(fragment).pipe(
              Effect.tap((continueReading) =>
                Effect.sync(() => {
                  storedStopped = !continueReading;
                }),
              ),
            ),
          )
        : Effect.void;
    if (stored && !durableReplay) {
      yield* readStored(request);
      if (storedStopped) return;
      if (complete && (yield* complete(request))) return;
    } else if (stored && durableReplay) {
      if (complete && (yield* complete(request))) {
        yield* readStored(request);
        return;
      }
    }
    if (!request.cwd) {
      if (stored && durableReplay) yield* readStored(request);
      return;
    }
    yield* this.#ensureInitializedEffect();
    if (this.#supportsSessionResume || !this.#loadsSessions) {
      if (stored && durableReplay) yield* readStored(request);
      return;
    }
    if (this.#openingTurns.has(request.threadId) || this.#threads.get(request.threadId)?.activeTurn) {
      if (stored && durableReplay) yield* readStored(request);
      return;
    }
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let resolveEnded!: () => void;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    const controller = new AbortController();
    const replay: HistoryReplay = {
      consume:
        durableReplay && append ? (fragment) => append(request.threadId, fragment).pipe(Effect.as(true)) : consume,
      items: request.items,
      itemsById: new Map(),
      currentTurnId: null,
      currentUserMessageId: null,
      currentUserItemId: null,
      currentAgentItemId: null,
      turnHasOutput: false,
      turnSequence: 0,
      currentTurnStartedAt: undefined,
      hasUpdates: false,
      queue: [],
      controller,
      stopped: false,
      sourceDone: false,
      draining: false,
      done,
      resolveDone,
      ended,
      pending: 0,
      error: null,
    };
    this.#historyReplays.set(request.threadId, replay);
    try {
      try {
        providerResult(
          yield* Effect.result(
            this.#startThread(
              {
                threadId: request.threadId,
                cwd: request.cwd,
                includeTurns: request.items === "full",
                dynamicTools: visibleDynamicTools(this.provider),
              },
              true,
            ),
          ),
        );
      } catch (error) {
        if (error instanceof MissingAcpSessionError) {
          if (stored && durableReplay) yield* readStored(request);
          return;
        }
        return yield* providerFailure(error);
      }
      this.#finishHistoryTurn(replay);
      this.#finishHistoryReplay(replay);
      yield* Effect.promise(() => replay.done);
      if (replay.error) return yield* providerFailure(replay.error);
      if (durableReplay && (!request.providerOnly || replay.hasUpdates)) {
        yield* readStored({
          threadId: request.threadId,
          items: request.items,
          ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        });
      }
    } finally {
      controller.abort();
      if (!replay.sourceDone) this.#abortHistoryReplay(replay);
      this.#historyReplays.delete(request.threadId);
      resolveEnded();
      const thread = this.#threads.get(request.threadId);
      if (thread && !thread.activeTurn) yield* this.#threads.markIdle(thread);
    }
  });

  get #label(): string {
    return this.options.label ?? agentProviderName(this.provider);
  }

  #redact(text: string): string {
    let result = redactText(text);
    for (const value of this.options.redactValues?.() ?? []) {
      if (value.length < 4) continue;
      result = result.split(value).join("[redacted]");
    }
    return result;
  }

  #withFailureDetail(error: unknown): unknown {
    if (!(error instanceof RequestError) || failureDetail(error) === null) return error;
    return new RequestError(error.code, this.#redact(failureText(error).replace(/^RequestError:\s*/u, "")), error.data);
  }

  get running(): boolean {
    return this.#transport.running;
  }

  start(): void {
    if (this.running) return;
    this.#scope = Scope.makeUnsafe();
    this.#promptAnswered = false;
    this.#transport.start();
  }

  readonly stop = Effect.fn("AcpAgentClient.stop")(function* (
    this: AcpAgentClient,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    yield* this.#deleteThrowawaySessions();
    yield* this.#transport
      .stop(
        Effect.gen({ self: this }, function* () {
          this.#initialized = null;
          for (const replay of this.#historyReplays.values()) this.#abortHistoryReplay(replay);
          this.#historyReplays.clear();
          const threads = this.#threads.clear();
          for (const thread of threads) thread.mcp.close();
          yield* Effect.forEach(threads, (thread) => thread.relays, { concurrency: "unbounded", discard: true });
          yield* Effect.forEach(
            threads,
            (thread) => (thread.transport ? thread.transport.stop(Effect.void).pipe(Effect.ignore) : Effect.void),
            { concurrency: "unbounded", discard: true },
          );
          yield* Effect.forEach(
            this.#openingSessionProcesses,
            (transport) => transport.stop(Effect.void).pipe(Effect.ignore),
            { concurrency: "unbounded", discard: true },
          );
          this.#startingThreads.clear();
          this.#stopSubagents();
          this.#serverRequests.rejectAll("ACP session stopped.");
          yield* this.#bridge.close().pipe(toProviderClientOperationError);
        }),
      )
      .pipe(Effect.ensuring(Scope.close(this.#scope, Exit.void)));
  }, Effect.uninterruptible);

  readonly #deleteThrowawaySessions = Effect.fn("AcpAgentClient.deleteThrowawaySessions")(function* (
    this: AcpAgentClient,
  ) {
    if (!this.#deletesSessions) return;
    const throwaway = [...this.#threads.ids()].flatMap((id) => {
      const thread = this.#threads.get(id);
      return thread?.throwaway ? [thread] : [];
    });
    yield* Effect.forEach(
      throwaway,
      (thread) => {
        const connection = thread.transport ? thread.transport.connection : this.#transport.connection;
        if (!connection) return Effect.void;
        return providerCall(() => connection.deleteSession({ sessionId: thread.id })).pipe(
          Effect.timeout(ACP_THROWAWAY_DELETE_MS),
          Effect.ignore,
        );
      },
      { concurrency: "unbounded", discard: true },
    );
  });

  readonly readSessionSettings = Effect.fn("AcpAgentClient.readSessionSettings")(function* (
    this: AcpAgentClient,
    threadId: string,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    const thread = yield* providerSync(() => this.#requireThread(threadId));
    return this.#configuration.sessionSettings(thread.configOptions);
  });

  readonly setSessionSetting = Effect.fn("AcpAgentClient.setSessionSetting")(function* (
    this: AcpAgentClient,
    threadId: string,
    configId: string,
    value: AgentSessionSettingValue,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    let thread = yield* providerSync(() => this.#requireThread(threadId));
    if (thread.activeTurn) return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingsBusy")));
    if (thread.needsResume && thread.transport && !thread.transport.running) {
      yield* this.#reopenThread(thread);
      thread = yield* providerSync(() => this.#requireThread(threadId));
    }
    const snapshot = yield* this.#configuration.set(thread, configId, value);
    this.#publishSessionSettings(thread);
    return snapshot;
  });

  #publishSessionSettings(thread: AcpThread): void {
    this.emit("notification", {
      method: "openbot/sessionSettings/updated",
      params: { threadId: thread.id, ...this.#configuration.sessionSettings(thread.configOptions) },
    });
  }

  #compacted(thread: AcpThread): void {
    if (thread.activeTurn) {
      thread.activeTurn.answered = true;
      thread.activeTurn.showedPlanOrCompaction = true;
    }
    thread.instructionsSent = null;
    this.#turnContext.resend(thread.id);
    this.emit("notification", {
      method: "openbot/context-compaction",
      params: { threadId: thread.id, status: "completed" },
    });
  }

  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError> {
    return this.#threads.releaseIdle();
  }

  readonly releaseQuietBackgroundThreads = Effect.fn("AcpAgentClient.releaseQuietBackgroundThreads")(function* (
    this: AcpAgentClient,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    if (!this.#loadsSessions) return;
    const now = Date.now();
    const closed = yield* this.#threads.releaseWhere(
      (thread) =>
        thread.workHold !== null &&
        (thread.transport !== null || this.#closesSessions) &&
        now - thread.workHold.changedAt >= ACP_WORK_HOLD_QUIET_RELEASE_MS,
    );
    for (const thread of closed)
      logger.warn("Closed an ACP session with quiet running work, because memory is low.", {
        provider: this.provider,
        threadId: thread.id,
      });
  });

  canReleaseProcess(): boolean {
    if (this.#threads.ids().next().done) return true;
    for (const id of this.#threads.ids()) {
      const thread = this.#threads.get(id);
      if (thread && (thread.workHold || this.#heldByBackgroundSubagent(thread))) return false;
    }
    return this.#supportsSessionResume || this.#loadsSessions;
  }

  callRelayedMcpTool(
    externalThreadId: string,
    config: McpServerConfig,
    tool: string,
    args: McpToolArguments,
  ): Effect.Effect<RelayedMcpToolOutcome | null> {
    return this.#relayFor(externalThreadId, config)?.callTool(tool, args) ?? Effect.succeed(null);
  }

  relaysMcpServer(externalThreadId: string, config: McpServerConfig): boolean {
    return this.#relayFor(externalThreadId, config) !== undefined;
  }

  #relayFor(externalThreadId: string, config: McpServerConfig): StdioMcpRelay | undefined {
    const thread = this.#threads.get(externalThreadId);
    if (!thread || thread.relayed.byName.size === 0) return undefined;
    return thread.relayed.byName.get(acpMcpServerName(config, thread.relayed.own, this.#flavor.mcpServerName));
  }

  readonly releaseThread = Effect.fn("AcpAgentClient.releaseThread")(function* (
    this: AcpAgentClient,
    sessionId: string,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#threads.forget(sessionId);
    this.#turnContext.forget(sessionId);
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    yield* this.#threads.close(thread).pipe(toProviderClientOperationError);
  });

  #forgetMissingSession(sessionId: string): void {
    this.#threads.forget(sessionId);
    this.#turnContext.forget(sessionId);
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    this.#threads.detach(thread);
    this.#stopThreadSubagents(thread.id);
    thread.mcp.close();
    Effect.runFork(thread.relays);
    if (thread.transport) Effect.runFork(thread.transport.stop(Effect.void).pipe(Effect.ignore));
  }

  readonly #closeSession = Effect.fn("AcpAgentClient.closeSession")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#markSessionClosed(thread.id);
    this.#stopThreadSubagents(thread.id);
    thread.mcp.close();
    yield* thread.relays;
    if (thread.transport) return yield* thread.transport.stop(Effect.void);
    yield* providerCall(() =>
      this.#transport.connection?.closeSession({ sessionId: thread.id, ...this.#forcedClose }).catch(() => undefined),
    );
  });

  #markSessionClosed(sessionId: string): void {
    const now = Date.now();
    for (const [id, at] of this.#closedSessions)
      if (now - at >= UNCLAIMED_MCP_FAILURE_MS) this.#closedSessions.delete(id);
    this.#closedSessions.set(sessionId, now);
  }

  #closedRecently(sessionId: string): boolean {
    const at = this.#closedSessions.get(sessionId);
    return at !== undefined && Date.now() - at < UNCLAIMED_MCP_FAILURE_MS;
  }

  readonly readUsageText = Effect.fn("AcpAgentClient.readUsageText")(function* (
    this: AcpAgentClient,
    _model: string,
    prompt: string,
  ): Effect.fn.Return<string | null, ProviderClientOperationError> {
    if (!this.running) return yield* providerFailure(new Error("ACP client is not running."));
    yield* this.#ensureInitializedEffect();
    if (!this.#signedIn) return null;
    const answer = yield* this.#privatePromptLock.withPermit(
      this.#privatePromptOnce(prompt).pipe(
        Effect.timeoutOrElse({
          duration: this.#requestTimeoutMs,
          orElse: () =>
            Effect.fail(providerFailure(new TimeoutError(`${this.#label} request timed out: usage prompt`))),
        }),
      ),
    );
    return this.#redact(answer).trim() || null;
  });

  readonly #privatePromptOnce = Effect.fn("AcpAgentClient.privatePrompt")(function* (
    this: AcpAgentClient,
    text: string,
  ): Effect.fn.Return<string, ProviderClientOperationError> {
    const connection = yield* providerSync(() => this.#requireConnection());
    if (this.#privateSession?.connection !== connection) {
      const { sessionId } = yield* providerCall(() =>
        connection.newSession({
          cwd: this.options.discoveryCwd?.() ?? process.cwd(),
          mcpServers: [],
          ...(this.#flavor.sessionMeta ? { _meta: this.#flavor.sessionMeta } : {}),
        }),
      );
      this.#privateSession = { connection, sessionId };
    }
    const { sessionId } = this.#privateSession;
    const answer: string[] = [];
    this.#privateAnswer = answer;
    return yield* providerCall(() => connection.prompt({ sessionId, prompt: [{ type: "text", text }] })).pipe(
      Effect.map(() => answer.join("")),
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          this.#privateAnswer = null;
          if (!Exit.hasInterrupts(exit)) return;
          this.#privateSession = null;
          yield* providerCall(() => connection.cancel({ sessionId })).pipe(Effect.ignore);
        }),
      ),
    );
  });

  readonly request = Effect.fn("AcpAgentClient.request")(function* <T>(
    this: AcpAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    const sessionId = getString(params, "threadId");
    const transport = (sessionId ? this.#threads.get(sessionId)?.transport : null) ?? this.#transport;
    const ended = transport.ended;
    let result = yield* Effect.result(this.#requestEffect(method, params, decoder, timeoutMs));
    if (
      Result.isFailure(result) &&
      sessionId &&
      (method === "turn/start" || method === "thread/resume") &&
      (yield* this.#discardLostTurns(sessionId, result.failure.cause))
    )
      result = yield* Effect.result(this.#requestEffect(method, params, decoder, timeoutMs));
    try {
      return providerResult(result);
    } catch (error) {
      if (error instanceof TimeoutError)
        yield* Effect.forkIn(
          this.#endIfUnresponsive(sessionId ? this.#threads.get(sessionId) : undefined),
          this.#scope,
        );
      if (
        sessionId &&
        (method === "turn/start" || method === "thread/resume") &&
        !this.#threads.get(sessionId)?.transport &&
        !this.#threads.get(sessionId)?.activeTurn &&
        this.#flavor.lostServerUntilRestart?.(error)
      ) {
        logger.warn("An ACP agent lost the connection to its server.", {
          provider: this.provider,
          reason: this.#redact(failureText(error)),
        });
        yield* this.#endFailingProcess(sessionId, this.#serverLostEnd(), false);
        return yield* providerFailure(new Error(sourceText("error.provider.acpServerLost", { provider: this.#label })));
      }
      if (
        sessionId &&
        (method === "turn/start" || method === "thread/resume") &&
        !this.#threads.get(sessionId)?.activeTurn &&
        isSessionNotFound(error, sessionId, this.#flavor)
      ) {
        this.#forgetMissingSession(sessionId);
        return yield* providerFailure(new MissingAcpSessionError(`ACP session not found: ${sessionId}`, error));
      }
      if (
        error instanceof RequestError &&
        (method === "turn/start" ||
          method === "turn/steer" ||
          ((method === "thread/start" || method === "thread/resume") && failureDetail(error) !== null))
      ) {
        return yield* providerFailure(
          new RequestError(error.code, this.#redact(failureText(error).replace(/^RequestError:\s*/u, ""))),
        );
      }
      return yield* providerFailure(yield* transport.explainEnd(error, ended));
    }
  });

  readonly #requestEffect = Effect.fn("AcpAgentClient.request")(function* <T>(
    this: AcpAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    if (!this.running) return yield* providerFailure(new Error("ACP client is not running."));
    switch (method) {
      case "initialize":
        yield* this.#ensureInitializedEffect(timeoutMs);
        return yield* providerSync(() => decoder({}));
      case "account/read": {
        if (!this.#signedIn) return yield* providerSync(() => decoder({ account: null, requiresOpenaiAuth: false }));
        const account = yield* this.#readProviderAccountEffect(timeoutMs);
        return yield* providerSync(() =>
          decoder({
            account: { type: this.provider, email: account.email, planType: account.planType },
            requiresOpenaiAuth: false,
          }),
        );
      }
      case "account/rateLimits/read":
        yield* this.#ensureInitializedEffect();
        if (!this.#signedIn) return yield* providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
        {
          const readRateLimits = this.options.readRateLimits;
          const response = readRateLimits
            ? yield* readRateLimits(this.#requireConnection(), this.#requestedModel(params)).pipe(
                Effect.timeoutOrElse({
                  duration: timeoutMs ?? this.#requestTimeoutMs,
                  orElse: () =>
                    Effect.fail(
                      providerFailure(new TimeoutError(`${this.#label} request timed out: account/rateLimits/read`)),
                    ),
                }),
                Effect.mapError((failure) => providerFailure(this.#withFailureDetail(failure.cause))),
              )
            : { rateLimits: null, rateLimitsByLimitId: null };
          return yield* providerSync(() => decoder(response));
        }
      case "model/list":
        yield* this.#ensureInitializedEffect();
        if (this.#signedIn) {
          try {
            const models = providerResult(yield* Effect.result(this.#discoverModels(timeoutMs)));
            if (models.length === 0 && this.#flavor.keepModelsOnRefreshFailure && !this.options.allowNoModels)
              throw new Error(sourceText("error.provider.acpNoModels"));
            this.#models = models;
          } catch (error) {
            if (!this.#flavor.keepModelsOnRefreshFailure || this.#models.length === 0 || isAuthenticationError(error))
              return yield* providerFailure(error);
            logger.warn("An ACP agent kept its last model list after a failed refresh.", {
              provider: this.provider,
              models: this.#models.length,
              reason: this.#redact(failureText(error)),
            });
          }
        }
        return yield* providerSync(() =>
          decoder({
            ...(this.#steerExtension || this.#steersByPrompt ? { steersTurns: true } : {}),
            data: this.#models.map((model) => ({
              model: this.options.encodesModelIds ? encodedModelId("", model.id) : model.id,
              displayName: model.name,
              description: model.description,
              defaultReasoningEffort: model.defaultReasoningEffort,
              supportedReasoningEfforts: model.supportedReasoningEfforts.map((reasoningEffort) => ({
                reasoningEffort,
              })),
              ...(model.reasoningEffortConfigurable ? {} : { reasoningEffortConfigurable: false }),
            })),
          }),
        );
      case "plugin/list":
        return yield* providerSync(() => decoder({ marketplaces: [] }));
      case "thread/start":
      case "thread/resume": {
        const response = yield* this.#startThread(params, method === "thread/resume");
        const resumed = method === "thread/resume" && getString(params, "threadId") === response.thread.id;
        this.#turnContext.set(response.thread.id, params, resumed);
        return yield* providerSync(() => decoder(response));
      }
      case "thread/read": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        const includeTurns = isRecord(params) && params.includeTurns === true;
        if (includeTurns) {
          const turns = new Map<string, { id: string; status?: string; startedAt?: number; items: ThreadItem[] }>();
          const seenItems = new Map<string, Set<string>>();
          const cwd = getString(params, "cwd");
          yield* this.readHistory(
            {
              threadId,
              items: "full",
              ...(cwd === null ? {} : { cwd }),
            },
            (fragment) =>
              Effect.sync(() => {
                let turn = turns.get(fragment.turnId);
                if (!turn) {
                  turn = { id: fragment.turnId, items: [] };
                  turns.set(fragment.turnId, turn);
                }
                if (fragment.status !== undefined) turn.status = fragment.status;
                if (fragment.startedAt !== undefined) turn.startedAt = fragment.startedAt;
                const ids = seenItems.get(fragment.turnId) ?? new Set<string>();
                for (const item of fragment.items) {
                  if (item.id && ids.has(item.id)) continue;
                  if (item.id) ids.add(item.id);
                  turn.items.push(item);
                }
                seenItems.set(fragment.turnId, ids);
                return true;
              }),
          );
          return yield* providerSync(() =>
            decoder({
              thread: {
                id: threadId,
                turns: [...turns.values()].reverse(),
              },
            }),
          );
        }
        yield* this.#readableThreadEffect(threadId, params);
        return yield* providerSync(() => decoder({ thread: { id: threadId, turns: [] } }));
      }
      case "turn/start": {
        const response = yield* this.#startTurnEffect(params);
        return yield* providerSync(() => decoder(response));
      }
      case "turn/steer": {
        const steer = this.#steerExtension;
        const byPrompt = this.#steersByPrompt;
        if (!steer && !byPrompt) return yield* providerFailure(new Error(sourceText("error.backend.steerUnsupported")));
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        const blocks = yield* promptBlocksEffect(params, this.#acceptsAudio);
        const thread = this.#threads.get(threadId);
        const turn = thread?.activeTurn;
        if (
          !thread ||
          !turn ||
          turn.id !== getString(params, "expectedTurnId") ||
          turn.stopped ||
          turn.completing ||
          (!steer && (turn.unprompted || turn.waitingOnUser > 0 || !turn.answered))
        )
          return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
        if (steer)
          yield* steer(this.#sessionConnection(thread), {
            sessionId: threadId,
            messageId: getString(params, "clientUserMessageId"),
            blocks,
          });
        else yield* turn.steerLock.withPermit(this.#steerByPrompt(thread, turn, blocks));
        turn.lastActivityAt = Date.now();
        turn.modelRetries = 0;
        return yield* providerSync(() => decoder({ turnId: turn.id }));
      }
      case "turn/interrupt": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        if (this.#threads.isReleased(threadId)) return yield* providerSync(() => decoder({}));
        const thread = yield* providerSync(() => this.#requireThread(threadId));
        const turn = thread.activeTurn;
        const requestedTurnId = getString(params, "turnId");
        if (!turn || (requestedTurnId !== null && requestedTurnId !== turn.id))
          return yield* providerSync(() => decoder({}));
        turn.stopped = true;
        turn.stop.abort();
        const cancel = providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id }));
        if (turn.unprompted) {
          turn.abandoned = true;
          yield* cancel.pipe(Effect.ignore);
          yield* this.#completeTurn(thread, turn, "interrupted", null);
        } else if (this.#flavor.cancelLocallyThenResume) {
          yield* cancel.pipe(Effect.ensuring(this.#abandonTurn(thread, turn, "interrupted", null)));
        } else {
          yield* Effect.forkIn(
            Effect.sleep(ACP_STOP_GRACE_MS).pipe(Effect.andThen(this.#abandonTurn(thread, turn, "interrupted", null))),
            this.#scope,
          );
          yield* cancel;
        }
        return yield* providerSync(() => decoder({}));
      }
      case "thread/compact/start":
        return yield* providerSync(() => decoder({}));
      default:
        return yield* providerFailure(new Error(`ACP adapter does not implement ${method}.`));
    }
  });

  notify(): void {}

  respond(id: RequestId, result: unknown): void {
    this.#serverRequests.resolve(id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#serverRequests.reject(id, error);
  }

  readonly #ensureInitializedEffect: (timeoutMs?: number) => Effect.Effect<void, ProviderClientOperationError> =
    Effect.fn("AcpAgentClient.ensureInitialized")(function* (
      this: AcpAgentClient,
      timeoutMs?: number,
    ): Effect.fn.Return<void, ProviderClientOperationError> {
      if (this.#initialized) return yield* Deferred.await(this.#initialized);
      const initialized = Deferred.makeUnsafe<void, ProviderClientOperationError>();
      this.#initialized = initialized;
      const exit = yield* Effect.exit(this.#initialize(timeoutMs ?? this.#requestTimeoutMs));
      yield* Deferred.done(initialized, exit);
      return yield* exit;
    }, Effect.uninterruptible);

  readonly #readProviderAccountEffect = Effect.fn("AcpAgentClient.readProviderAccount")(function* (
    this: AcpAgentClient,
    timeoutMs?: number,
  ): Effect.fn.Return<AcpProviderAccount, ProviderClientOperationError> {
    const readAccount = this.options.readAccount;
    if (!readAccount) return { email: null, planType: null };
    try {
      const account = providerResult(
        yield* Effect.result(
          readAccount(this.#requireConnection()).pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs ?? this.#requestTimeoutMs,
              orElse: () =>
                Effect.fail(providerFailure(new TimeoutError(`${this.#label} request timed out: account/read`))),
            }),
          ),
        ),
      );
      return { email: account.email ?? null, planType: account.planType ?? null };
    } catch {
      return { email: null, planType: null };
    }
  });

  readonly #discoverModels = Effect.fn("AcpAgentClient.discoverModels")(function* (
    this: AcpAgentClient,
    timeoutMs?: number,
  ): Effect.fn.Return<AcpModel[], ProviderClientOperationError> {
    const [listed, additional] = yield* Effect.all(
      [this.#configuration.discoverModels(timeoutMs), this.options.additionalModels?.() ?? Effect.succeed([])],
      { concurrency: "unbounded" },
    );
    if (listed.length === 0) return listed;
    const modelName = this.options.modelName;
    const named = modelName ? listed.map((model) => ({ ...model, name: modelName(model.id, model.name) })) : listed;
    const ids = new Set(named.map((model) => model.id));
    return [...named, ...additional.filter((model) => !ids.has(model.id))];
  });

  readonly #initialize = Effect.fn("AcpAgentClient.initialize")(function* (
    this: AcpAgentClient,
    timeoutMs: number,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const connection = yield* providerSync(() => this.#requireConnection());
    const startTimeout = this.#startTimeout(timeoutMs);
    this.#startTimeoutMs = timeoutMs;
    this.#initialization = yield* this.#initializeConnection(connection).pipe(startTimeout);
    const initialization = this.#initialization;
    try {
      providerResult(
        yield* Effect.result(
          (this.options.authenticate?.(connection, initialization) ?? Effect.void).pipe(startTimeout),
        ),
      );
      let discovered = yield* Effect.result(this.#discoverModels(timeoutMs));
      if (Result.isFailure(discovered) && this.#signInUnusable(discovered.failure.cause))
        discovered = yield* Effect.result(this.#discoverModels(timeoutMs));
      this.#models = providerResult(discovered);
      if (this.#models.length === 0 && this.options.noModelsWhenSignedOut) {
        this.#signedIn = false;
        return;
      }
      if (this.#models.length === 0 && !this.options.allowNoModels) {
        throw new Error(sourceText("error.provider.acpNoModels"));
      }
      if (yield* this.options.savedSignInCheck?.refusedAtStart() ?? Effect.succeed(false)) {
        this.#models = [];
        this.#signedIn = false;
        return;
      }
      this.#signedIn = true;
    } catch (error) {
      if (isAuthenticationError(error)) {
        const keyRefused = this.options.savedKeyRefusedMessage?.();
        if (keyRefused) return yield* providerFailure(new ProviderSignInError({ message: keyRefused }));
        const blocked = this.options.authBlockedMessage?.();
        if (blocked) return yield* providerFailure(new Error(blocked));
        logger.warn("An ACP agent reported no sign-in.", {
          provider: this.provider,
          message: this.#redact(failureText(error)),
        });
        this.#signedIn = false;
        return;
      }
      const unusable = this.#signInUnusable(error);
      if (unusable) {
        logger.warn("An ACP agent could not use its sign-in.", {
          provider: this.provider,
          message: this.#redact(failureText(error)),
        });
        return yield* providerFailure(new ProviderSignInError({ message: unusable }));
      }
      return yield* providerFailure(this.#withFailureDetail(error));
    }
  });

  #signInUnusable(error: unknown): string | null {
    return error instanceof RequestError ? (this.#flavor.signInUnusable?.(error) ?? null) : null;
  }

  #startTimeout(timeoutMs: number) {
    return Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(
          providerFailure(
            new TimeoutError(
              sourceText("error.provider.acpStartTimedOut", {
                provider: this.#label,
                seconds: String(Math.round(timeoutMs / 1_000)),
              }),
            ),
          ),
        ),
    });
  }

  #initializeConnection(
    connection: ClientSideConnection,
  ): Effect.Effect<InitializeResponse, ProviderClientOperationError> {
    return providerCall(() =>
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities: this.#flavor.childSessionUpdates
          ? { ...OPENBOT_ACP_CLIENT_CAPABILITIES, _meta: { [OPENCODE_CHILD_SESSION_UPDATES]: true } }
          : OPENBOT_ACP_CLIENT_CAPABILITIES,
        clientInfo: this.#flavor.clientInfo ?? OPENBOT_ACP_CLIENT_INFO,
      }),
    );
  }

  readonly #startSessionProcess = Effect.fn("AcpAgentClient.startSessionProcess")(function* (
    this: AcpAgentClient,
    owner: () => AcpThread | null,
  ): Effect.fn.Return<AcpConnection, ProviderClientOperationError> {
    const transport: AcpConnection = this.#newTransport(() => {
      const thread = owner();
      if (thread?.transport === transport) thread.needsResume = true;
    });
    this.#openingSessionProcesses.add(transport);
    const startTimeout = this.#startTimeout(
      Math.max(this.#startTimeoutMs ?? this.#requestTimeoutMs, ACP_SESSION_PROCESS_START_TIMEOUT_MS),
    );
    yield* Effect.gen({ self: this }, function* () {
      yield* providerSync(() => {
        if (!this.running) throw new Error("ACP client is not running.");
        transport.start();
      });
      const connection = yield* providerSync(() => transport.requireConnection());
      const initialization = yield* this.#initializeConnection(connection).pipe(startTimeout);
      yield* (this.options.authenticate?.(connection, initialization) ?? Effect.void).pipe(startTimeout);
    }).pipe(
      Effect.catch((failure) => this.#explainSessionEnd(transport, failure.cause).pipe(Effect.flatMap(Effect.fail))),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        this.#openingSessionProcesses.delete(transport);
        return transport.stop(Effect.void).pipe(Effect.ignore);
      }),
    );
    return transport;
  });

  #explainSessionEnd(transport: AcpConnection, error: unknown): Effect.Effect<ProviderClientOperationError> {
    return transport.explainEnd(error, transport.ended).pipe(
      Effect.catch(() => Effect.succeed(error)),
      Effect.map(providerFailure),
    );
  }

  #reopenThread(thread: AcpThread): Effect.Effect<{ thread: { id: string } }, ProviderClientOperationError> {
    return this.#startThread(
      {
        threadId: thread.id,
        cwd: thread.cwd,
        developerInstructions: thread.developerInstructions,
        dynamicTools: thread.dynamicTools,
        runtimeWorkspaceRoots: thread.workspaceRoots,
        computerUse: thread.computerUse,
        openbotAgentId: thread.agentId ?? undefined,
        model: thread.currentModelId,
      },
      true,
    );
  }

  #sessionConnection(thread: AcpThread): ClientSideConnection {
    return thread.transport ? thread.transport.requireConnection() : this.#requireConnection();
  }

  readonly #readableThreadEffect = Effect.fn("AcpAgentClient.readableThread")(function* (
    this: AcpAgentClient,
    id: string,
    params: unknown,
  ): Effect.fn.Return<AcpThread | null, ProviderClientOperationError> {
    const held = this.#threads.get(id);
    if (held) return yield* providerSync(() => held);
    if (!isRecord(params) || !getString(params, "cwd")) return null;
    const resuming = this.#startingThreads.has(id);
    try {
      providerResult(yield* Effect.result(this.#ensureInitializedEffect()));
      if (!this.#loadsSessions) return null;
      providerResult(
        yield* Effect.result(this.#startThread({ ...params, dynamicTools: visibleDynamicTools(this.provider) }, true)),
      );
    } catch (error) {
      if (!(error instanceof MissingAcpSessionError)) {
        this.emit("diagnostic", this.#redact(`ACP session load for a read failed: ${String(error)}`));
      }
      return null;
    }
    const thread = this.#threads.get(id) ?? null;
    if (thread && !resuming && thread.idleSince === 0 && !thread.activeTurn) yield* this.#threads.markIdle(thread);
    return yield* providerSync(() => thread);
  });

  get #loadsSessions(): boolean {
    return this.#initialization?.agentCapabilities?.loadSession === true;
  }

  get #closesSessions(): boolean {
    return Boolean(this.#initialization?.agentCapabilities?.sessionCapabilities?.close);
  }

  get #deletesSessions(): boolean {
    return this.#initialization?.agentCapabilities?.sessionCapabilities?.delete != null;
  }

  get #forcedClose(): { _meta?: { "cognition.ai/force": true } } {
    const meta = this.#initialization?.agentCapabilities?.sessionCapabilities?.close?._meta;
    return meta?.["cognition.ai/force"] === true ? { _meta: { "cognition.ai/force": true } } : {};
  }

  get #acceptsAudio(): boolean {
    return this.#initialization?.agentCapabilities?.promptCapabilities?.audio === true;
  }

  get #steerExtension(): AcpProviderOptions["steer"] {
    const { steer, steers } = this.options;
    if (!steers) return steer;
    return this.#initialization && steers(this.#initialization) ? steer : undefined;
  }

  get #steersByPrompt(): boolean {
    const capability = this.#flavor.steerByPromptCapability;
    const meta = this.#initialization?.agentCapabilities?._meta;
    if (capability !== undefined && isRecord(meta) && meta[capability] === true) return true;
    const since = this.#flavor.steerByPromptSince;
    const version = this.#initialization?.agentInfo?.version;
    return (
      since !== undefined && typeof version === "string" && isVersion(version) && compareReleases(version, since) >= 0
    );
  }

  #listedInTime(mcp: LocalMcpSession, sentAt: number, waitedMs = 0): boolean {
    const limit = this.#flavor.mcpListLimit;
    const version = this.#initialization?.agentInfo?.version;
    if (
      !limit ||
      mcp.servers.length === 0 ||
      typeof version !== "string" ||
      !isVersion(version) ||
      compareReleases(version, limit.since) < 0
    )
      return true;
    return mcp.listedWithin(sentAt, Math.max(limit.ms + ACP_MCP_LIST_MARGIN_MS, waitedMs));
  }

  get #sessionProcesses(): boolean {
    if (this.#flavor.sessionProcesses) return true;
    const before = this.#flavor.sessionProcessesBefore;
    const version = this.#initialization?.agentInfo?.version;
    return before !== undefined && typeof version === "string" && olderVersion(version, before);
  }

  get #supportsSessionResume(): boolean {
    if (this.#flavor.loadInsteadOfResume) return false;
    return this.#initialization?.agentCapabilities?.sessionCapabilities?.resume != null;
  }

  get #acceptsAdditionalDirectories(): boolean {
    return (
      this.#flavor.workspaceAsAdditionalDirectory === true ||
      this.#initialization?.agentCapabilities?.sessionCapabilities?.additionalDirectories != null
    );
  }

  #workspaceRootsChanged(thread: AcpThread, params: unknown): boolean {
    if (!this.#acceptsAdditionalDirectories || !isRecord(params) || !Array.isArray(params.runtimeWorkspaceRoots))
      return false;
    const roots = params.runtimeWorkspaceRoots.filter(isString);
    return roots.join("\n") !== thread.workspaceRoots.join("\n");
  }

  readonly #startThread = Effect.fn("AcpAgentClient.startThread")(function* (
    this: AcpAgentClient,
    params: unknown,
    resume: boolean,
  ): Effect.fn.Return<{ thread: { id: string } }, ProviderClientOperationError> {
    yield* this.#ensureInitializedEffect();
    if (!this.#signedIn) return yield* providerFailure(new Error(this.options.signInMessage));
    const requestedThreadId = getString(params, "threadId");
    if (!resume || !requestedThreadId) return yield* this.#openThread(params, false);
    const held = this.#threads.get(requestedThreadId);
    const recovering = held && !held.activeTurn && held.needsResume;
    if (
      held &&
      !recovering &&
      !held.activeTurn &&
      (held.computerUse !== computerUseParam(params) || this.#workspaceRootsChanged(held, params))
    ) {
      yield* this.#threads.close(held).pipe(toProviderClientOperationError);
    } else if (held && !recovering) {
      held.developerInstructions = getString(params, "developerInstructions") ?? held.developerInstructions;
      held.agentId ??= mcpAgentParam(params);
      yield* this.#configuration.applyConfig(
        held,
        this.#requestedModel(params),
        getString(params, "effort"),
        this.#models,
      );
      return { thread: { id: requestedThreadId } };
    }
    const starting = this.#startingThreads.get(requestedThreadId);
    if (starting) return yield* Deferred.await(starting);
    const completion = Deferred.makeUnsafe<{ thread: { id: string } }, ProviderClientOperationError>();
    this.#startingThreads.set(requestedThreadId, completion);
    this.#closedSessions.delete(requestedThreadId);
    if (recovering && held.transport) yield* held.transport.stop(Effect.void).pipe(Effect.ignore);
    else if (
      (recovering && this.#closesSessions && !this.#supportsSessionResume && held.backgroundUntil === 0) ||
      (!held && this.#loadsSessions && this.#forcedClose._meta && !this.#threads.isReleased(requestedThreadId))
    ) {
      this.#stopThreadSubagents(requestedThreadId);
      yield* providerCall(() =>
        this.#requireConnection().closeSession({ sessionId: requestedThreadId, ...this.#forcedClose }),
      ).pipe(this.#backgroundTimeout("session/close"), Effect.ignore);
    }
    const exit = yield* Effect.exit(this.#openThread(params, true));
    if (recovering && Exit.isSuccess(exit)) {
      held.mcp.close();
      yield* held.relays;
    }
    yield* Deferred.done(completion, exit);
    if (this.#startingThreads.get(requestedThreadId) === completion) this.#startingThreads.delete(requestedThreadId);
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #openThread = Effect.fn("AcpAgentClient.openThread")(function* (
    this: AcpAgentClient,
    params: unknown,
    resume: boolean,
  ): Effect.fn.Return<{ thread: { id: string } }, ProviderClientOperationError> {
    const requestedThreadId = getString(params, "threadId");
    if (resume && requestedThreadId && !this.#supportsSessionResume && !this.#loadsSessions) {
      return yield* providerFailure(new Error(`Unknown ACP session: ${requestedThreadId}`));
    }
    const cwd = yield* providerSync(() => requiredString(params, "cwd"));
    const listed = getArray(params, "dynamicTools").filter(isDynamicToolNamespace);
    const given = isRecord(params) && params.channelTools === true ? withChannelTools(listed) : listed;
    const dynamicTools = this.#flavor.catalogAsMcpTools ? withCatalogTools(given, this.provider) : given;
    const computerUse = computerUseParam(params);
    const agentId = mcpAgentParam(params);
    let threadRef: AcpThread | null = null;
    let transport: AcpConnection | null = null;
    let closeRelays: Effect.Effect<void> | null = null;
    let relayedServers: RelayedMcpServers = { own: [], byName: new Map() };
    let retained = false;
    const relaysStdio =
      this.#flavor.relayStdioMcpServers === true ||
      (this.#flavor.relayStdioMcpServers === "unconfined" && !this.options.confine);
    return yield* Effect.acquireUseRelease(
      this.#bridge
        .createSession(
          requestedThreadId ?? randomUUID(),
          dynamicTools,
          () => threadRef?.activeTurn?.id ?? null,
          (call, signal, detachAfterMs, subagent) => this.#callDynamicTool(call, signal, detachAfterMs, subagent),
          this.#flavor.mcpServersPerDirectory ? cwd : undefined,
        )
        .pipe(toProviderClientOperationError),
      (mcp) =>
        Effect.gen({ self: this }, function* () {
          try {
            if (this.#sessionProcesses)
              transport = providerResult(yield* Effect.result(this.#startSessionProcess(() => threadRef)));
            const sessionTransport = transport;
            const connection = () =>
              sessionTransport ? sessionTransport.requireConnection() : this.#requireConnection();
            const afterSignInRead = <A>(request: Effect.Effect<A, ProviderClientOperationError>) =>
              sessionTransport && this.#flavor.authRequiredSignsOut
                ? request.pipe(
                    Effect.catchIf(
                      (failure) => failure.cause instanceof RequestError && failure.cause.code === -32000,
                      () => Effect.sleep(SESSION_SIGN_IN_RETRY_MS).pipe(Effect.andThen(request)),
                    ),
                  )
                : request;
            const additionalDirectories = getArray(params, "runtimeWorkspaceRoots").filter(isString);
            const directories = this.#acceptsAdditionalDirectories
              ? {
                  additionalDirectories: this.#flavor.workspaceAsAdditionalDirectory
                    ? [cwd, ...additionalDirectories.filter((root) => root !== cwd)]
                    : additionalDirectories,
                }
              : {};
            const meta = this.#flavor.sessionMeta ? { _meta: this.#flavor.sessionMeta } : {};
            let id: string;
            let configOptions: SessionConfigOption[];
            let currentModelId: string | null;
            const ownMcpServerNames = this.#ownMcpServerNames(cwd);
            const handoff = acpMcpServers(
              providerResult(
                yield* Effect.result(
                  usableMcpServers(
                    agentMcpServers(this.options.mcpServers?.(agentId) ?? [], computerUse),
                    this.options.mcpToolRuntimes?.(),
                    this.options.mcpEndpoint,
                    agentId,
                  ).pipe(toProviderClientOperationError),
                ),
              ),
              ownMcpServerNames,
              this.#flavor.mcpServerName,
              relaysStdio,
              Math.max(0, (this.#flavor.mcpServerLimit ?? Number.POSITIVE_INFINITY) - mcp.servers.length),
            );
            this.options.reportMcpDrops?.(this.provider, handoff.dropped);
            let given = handoff.servers;
            if (relaysStdio) {
              const relayed = providerResult(yield* Effect.result(this.#relayStdioMcpServers(given, cwd)));
              given = relayed.servers;
              closeRelays = relayed.close;
              relayedServers = { own: ownMcpServerNames, byName: relayed.byName };
            }
            let mcpServers = [...given, ...mcp.servers];
            const enableMcpServers = this.#flavor.enableMcpServers;
            if (enableMcpServers) {
              const names = mcp.servers.map((server) => server.name);
              yield* Effect.try({ try: () => enableMcpServers(cwd, names), catch: String }).pipe(
                Effect.catch((error) =>
                  Effect.sync(() =>
                    this.emit(
                      "diagnostic",
                      this.#redact(`OpenBot could not turn on its ${this.#label} MCP servers: ${error}`),
                    ),
                  ),
                ),
              );
            }
            const sentAt = Date.now();
            if (resume && requestedThreadId) {
              const restored = this.#restoreSessionEffect(
                connection,
                { sessionId: requestedThreadId, cwd, ...directories, mcpServers, ...meta },
                this.#supportsSessionResume ? "resume" : "load",
              );
              const response = providerResult(
                yield* Effect.result(afterSignInRead(sessionTransport ? restored : this.#whileProcessWrites(restored))),
              );
              id = requestedThreadId;
              configOptions = response.configOptions ?? [];
              currentModelId = currentModelFromSessionSetup(response);
            } else {
              const created = providerCall(() => connection().newSession({ cwd, ...directories, mcpServers, ...meta }));
              const response = providerResult(
                yield* Effect.result(afterSignInRead(sessionTransport ? created : this.#whileProcessWrites(created))),
              );
              id = response.sessionId;
              configOptions = response.configOptions ?? [];
              currentModelId = currentModelFromSessionSetup(response);
            }
            const openedAt = Date.now();
            const connectLimit = this.#flavor.mcpConnectLimitMs;
            if (connectLimit !== undefined && this.#supportsSessionResume && mcp.dropped(sentAt, connectLimit)) {
              this.emit("diagnostic", `${this.#label} did not load OpenBot's tools in time. The session opens again.`);
              mcpServers = [...given, ...mcp.renew()];
              const retriedAt = Date.now();
              const retry = this.#restoreSessionEffect(
                connection,
                { sessionId: id, cwd, ...directories, mcpServers, ...meta },
                "resume",
              );
              const retried = yield* Effect.result(sessionTransport ? retry : this.#whileProcessWrites(retry));
              if (Result.isFailure(retried) || mcp.dropped(retriedAt, connectLimit))
                this.emit("diagnostic", `${this.#label} still did not load OpenBot's tools.`);
            }
            if (this.#flavor.mcpServersLoadWithSession && !mcp.reached())
              throw new Error(sourceText("error.provider.acpMcpNotLoaded", { provider: this.#label }));
            mcp.setThreadId(id);
            const kept = resume && this.#flavor.reopenKeepsPrompts ? this.#threads.released(id) : undefined;
            const thread: AcpThread = {
              id,
              cwd,
              developerInstructions: getString(params, "developerInstructions") ?? "",
              instructionsSent: kept?.instructionsSent ?? null,
              contextUsed: kept?.contextUsed ?? null,
              promptsSinceInstructions: kept?.promptsSinceInstructions ?? 0,
              configOptions,
              currentModelId,
              mcp,
              mcpListed: this.#listedInTime(mcp, sentAt, openedAt - sentAt),
              relays: closeRelays ?? Effect.void,
              relayed: relayedServers,
              activeTurn: null,
              needsResume: false,
              transport: sessionTransport,
              dynamicTools,
              workspaceRoots: additionalDirectories,
              computerUse,
              agentId,
              idleRelease: null,
              idleSince: 0,
              restore: { cwd, ...directories, mcpServers, ...meta },
              shownIds: new Set(),
              backgroundUntil: 0,
              backgroundUpdatedAt: null,
              backgroundSkipUntil: 0,
              backgroundReplay: null,
              workHold: null,
              leftOutMcpServers: new Map(),
              throwaway: isRecord(params) && params.ephemeral === true,
            };
            threadRef = thread;
            providerResult(
              yield* Effect.result(
                this.#configuration.applyConfig(
                  thread,
                  this.#requestedModel(params),
                  getString(params, "effort"),
                  this.#models,
                ),
              ),
            );
            if (sessionTransport && !this.running) throw new Error("ACP client is not running.");
            this.#threads.add(thread);
            retained = true;
            const early = this.#unclaimedMcpFailures.filter((failure) => failure.sessionId === id);
            this.#unclaimedMcpFailures = this.#unclaimedMcpFailures.filter((failure) => failure.sessionId !== id);
            for (const failure of early) this.#reportMcpServerFailure(thread, failure);
            return { thread: { id } };
          } catch (error) {
            if (this.#flavor.authRequiredSignsOut && error instanceof RequestError && error.code === -32000) {
              const keyRefused = this.options.savedKeyRefusedMessage?.();
              if (keyRefused) return yield* providerFailure(new ProviderSignInError({ message: keyRefused }));
              const blocked = this.options.authBlockedMessage?.();
              if (blocked) {
                this.emit("exit", new Error(blocked));
                return yield* providerFailure(new Error(blocked));
              }
              this.#signedIn = false;
              this.emit("exit", new Error(this.options.signInMessage));
            }
            if (!this.#signedIn) return yield* providerFailure(new Error(this.options.signInMessage));
            return yield* transport ? yield* this.#explainSessionEnd(transport, error) : providerFailure(error);
          }
        }),
      (mcp) =>
        Effect.gen({ self: this }, function* () {
          if (transport) this.#openingSessionProcesses.delete(transport);
          if (retained) return;
          mcp.close();
          if (closeRelays) yield* closeRelays;
          if (transport) yield* transport.stop(Effect.void).pipe(Effect.ignore);
        }),
    );
  });

  readonly #relayStdioMcpServers = Effect.fn("AcpAgentClient.relayStdioMcpServers")(function* (
    this: AcpAgentClient,
    servers: readonly AcpMcpServer[],
    cwd: string,
  ) {
    const used: Array<{ key: string | null; entry: SharedStdioRelay }> = [];
    const release = ({ key, entry }: { key: string | null; entry: SharedStdioRelay }) =>
      Effect.suspend(() => {
        entry.users -= 1;
        if (entry.users > 0) return Effect.void;
        if (key !== null && this.#sharedRelays.get(key) === entry) this.#sharedRelays.delete(key);
        return Effect.forEach(
          [entry.relay, ...entry.replaced],
          (relay) =>
            Deferred.await(relay).pipe(
              Effect.flatMap((started) => started.close()),
              Effect.ignore,
            ),
          { discard: true, concurrency: "unbounded" },
        );
      });
    const close = Effect.suspend(() =>
      Effect.forEach(used.splice(0), release, { discard: true, concurrency: "unbounded" }),
    );
    const byName = new Map<string, StdioMcpRelay>();
    const environment = () => {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) values[key] = value;
      return Object.assign(values, cliPathEnvironment(this.#cli), this.options.env, this.options.extraEnv?.());
    };
    const relayed = yield* Effect.forEach(servers, (server) =>
      Effect.gen({ self: this }, function* () {
        if ("type" in server) return server;
        const key = this.#flavor.mcpServersPerDirectory ? JSON.stringify([cwd, server.name]) : null;
        const launch = JSON.stringify([server.command, server.args, server.env, server.cwd]);
        const shared = key === null ? undefined : this.#sharedRelays.get(key);
        const entry: SharedStdioRelay = shared ?? { launch, relay: Deferred.makeUnsafe(), replaced: [], users: 0 };
        entry.users += 1;
        used.push({ key, entry });
        if (key !== null && !shared) this.#sharedRelays.set(key, entry);
        if (!shared || entry.launch !== launch) {
          if (shared) {
            entry.replaced.push(entry.relay);
            entry.relay = Deferred.makeUnsafe();
            entry.launch = launch;
          }
          const relay = entry.relay;
          yield* Effect.exit(
            startStdioMcpRelay({
              command: server.command,
              args: server.args,
              env: { ...environment(), ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])) },
              cwd: server.cwd ? resolve(cwd, server.cwd) : cwd,
              onStartAbandoned: () =>
                this.#reportFailedMcpServer(
                  cwd,
                  server.name,
                  sourceText("error.backend.mcpServerStartAbandoned", { provider: this.#label }),
                ),
            }),
          ).pipe(
            Effect.flatMap((started) => {
              if (Exit.isFailure(started) && entry.relay === relay) entry.launch = "";
              return Deferred.done(relay, started);
            }),
            Effect.uninterruptible,
          );
        }
        const relay = yield* Deferred.await(entry.relay);
        byName.set(server.name, relay);
        return {
          type: "http" as const,
          name: server.name,
          url: relay.url,
          headers: [{ name: "Authorization", value: `Bearer ${relay.token}` }],
        };
      }),
    ).pipe(Effect.onError(() => close));
    return { servers: relayed, close, byName };
  });

  readonly #restoreSessionEffect = Effect.fn("AcpAgentClient.restoreSession")(function* (
    this: AcpAgentClient,
    connection: () => ClientSideConnection,
    request: LoadSessionRequest,
    method: "load" | "resume",
  ): Effect.fn.Return<LoadSessionResponse | ResumeSessionResponse, ProviderClientOperationError> {
    const restore = (current: ClientSideConnection) =>
      providerCall(() =>
        method === "resume"
          ? current.resumeSession(request satisfies ResumeSessionRequest)
          : current.loadSession(request),
      );
    let failure: unknown;
    let recovery: ReturnType<NonNullable<AcpFlavor["restoreFailure"]>> = null;
    let restored: LoadSessionResponse | ResumeSessionResponse | undefined;
    try {
      restored = providerResult(yield* Effect.result(providerSync(connection).pipe(Effect.flatMap(restore))));
    } catch (error) {
      if (method === "load" && isSessionNotFound(error, request.sessionId, this.#flavor)) {
        return yield* providerFailure(new MissingAcpSessionError(`ACP session not found: ${request.sessionId}`, error));
      }
      if (this.#flavor.sessionBusy?.(error)) return yield* providerFailure(new ProviderSessionBusyError(this.#label));
      recovery = this.#flavor.restoreFailure?.(error, method) ?? null;
      if (!recovery) return yield* providerFailure(error);
      failure = error;
    }
    if (restored) {
      if (method === "load" && this.#flavor.loadInsteadOfResume?.missing(restored))
        return yield* providerFailure(
          new MissingAcpSessionError(`ACP session not found: ${request.sessionId}`, "empty session/load reply"),
        );
      return restored;
    }
    if (recovery === "wait-for-start") {
      yield* Effect.sleep(RESTORE_START_RETRY_MS);
      const current = yield* providerSync(connection);
      return yield* restore(current);
    }
    const listing = yield* this.#sessionListingEffect(yield* providerSync(connection), request);
    if (recovery === "confirm-missing")
      return yield* providerFailure(
        listing === "absent"
          ? new MissingAcpSessionError(`ACP session not found: ${request.sessionId}`, failure)
          : failure,
      );
    if (listing === "absent")
      return yield* providerFailure(
        new MissingAcpSessionError(
          `OpenCode session not found: ${request.sessionId} (OpenCode service failure)`,
          failure,
        ),
      );
    yield* Effect.sleep(RESTORE_LIST_RETRY_MS);
    try {
      return providerResult(yield* Effect.result(providerSync(connection).pipe(Effect.flatMap(restore))));
    } catch (error) {
      if (this.#flavor.restoreFailure?.(error, method) !== "list-sessions") return yield* providerFailure(error);
      return yield* providerFailure(new Error(sourceText("error.provider.opencodeServiceFailure"), { cause: error }));
    }
  });

  #enqueueHistoryFragment(replay: HistoryReplay, fragment: ProviderHistoryFragment): void {
    if (replay.stopped || replay.error) return;
    if (replay.pending >= ACP_HISTORY_REPLAY_QUEUE_LIMIT) {
      this.#abortHistoryReplay(replay, new Error("ACP history consumer is too slow."));
      return;
    }
    replay.pending += 1;
    replay.queue.push(fragment);
    void this.#drainHistoryReplay(replay);
  }

  async #drainHistoryReplay(replay: HistoryReplay): Promise<void> {
    if (replay.draining) return;
    replay.draining = true;
    try {
      while (replay.queue.length > 0 && !replay.stopped && !replay.error) {
        const fragment = replay.queue.shift();
        if (!fragment) break;
        try {
          replay.stopped = !(await Effect.runPromise(replay.consume(fragment), { signal: replay.controller.signal }));
          replay.pending -= 1;
          if (replay.stopped) {
            replay.queue.length = 0;
            replay.pending = 0;
          }
        } catch (error) {
          this.#abortHistoryReplay(replay, error);
        }
      }
    } finally {
      replay.draining = false;
      this.#resolveHistoryReplay(replay);
    }
  }

  #finishHistoryReplay(replay: HistoryReplay): void {
    replay.sourceDone = true;
    this.#resolveHistoryReplay(replay);
  }

  #abortHistoryReplay(replay: HistoryReplay, error?: unknown): void {
    replay.error ??= error ?? new Error("ACP history replay was cancelled.");
    replay.controller.abort();
    replay.stopped = true;
    replay.queue.length = 0;
    replay.pending = 0;
    this.#resolveHistoryReplay(replay);
  }

  #resolveHistoryReplay(replay: HistoryReplay): void {
    if ((replay.sourceDone || replay.stopped || replay.error) && !replay.draining && replay.queue.length === 0)
      replay.resolveDone();
  }

  #historyUpdate(replay: HistoryReplay, notification: SessionNotification): void {
    replay.hasUpdates = true;
    let update = notification.update;
    const messageId = contentMessageId(update);
    const startsTurn =
      update.sessionUpdate === "user_message_chunk" &&
      (replay.currentTurnId === null ||
        (messageId !== null && replay.currentUserMessageId !== null && messageId !== replay.currentUserMessageId) ||
        replay.turnHasOutput);
    if (startsTurn) {
      this.#finishHistoryTurn(replay);
      replay.turnSequence += 1;
      replay.currentTurnId = `${notification.sessionId}:history:${String(replay.turnSequence).padStart(12, "0")}`;
      replay.currentTurnStartedAt = undefined;
      replay.currentUserMessageId = messageId;
      replay.currentUserItemId = null;
      replay.currentAgentItemId = null;
    } else if (replay.currentTurnId === null) {
      replay.turnSequence += 1;
      replay.currentTurnId = `${notification.sessionId}:history:${String(replay.turnSequence).padStart(12, "0")}`;
      replay.currentTurnStartedAt = undefined;
      replay.currentUserMessageId = update.sessionUpdate === "user_message_chunk" ? messageId : null;
      replay.currentUserItemId = null;
      replay.currentAgentItemId = null;
    } else if (update.sessionUpdate === "user_message_chunk" && replay.currentUserMessageId === null) {
      replay.currentUserMessageId = messageId;
    }
    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk" ||
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      replay.turnHasOutput = true;
    }
    if (replay.items === "none") return;
    if (
      update.sessionUpdate === "user_message_chunk" &&
      update.content.type === "text" &&
      isTurnContextBlock(update.content.text)
    ) {
      const text = withoutTurnContext(update.content.text);
      if (!text) return;
      update = { ...update, content: { ...update.content, text } };
    }
    if (
      (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk") &&
      update.content.type === "text" &&
      update.content.text
    ) {
      const turnId = replay.currentTurnId;
      if (!turnId) return;
      const isUser = update.sessionUpdate === "user_message_chunk";
      const previousId = isUser ? replay.currentUserItemId : replay.currentAgentItemId;
      const id = messageId ?? previousId ?? `${turnId}:${update.sessionUpdate}`;
      const previous = replay.itemsById.get(id);
      if (!previous) this.#flushHistoryItems(replay);
      if (replay.stopped || replay.error) return;
      if (!previous && replay.itemsById.size >= ACP_HISTORY_REPLAY_QUEUE_LIMIT) {
        this.#abortHistoryReplay(replay, new Error("ACP history replay has too many active items."));
        return;
      }
      replay.itemsById.set(id, {
        ...(previous ?? {}),
        id,
        type: update.sessionUpdate === "user_message_chunk" ? "userMessage" : "agentMessage",
        ...(update.sessionUpdate === "agent_message_chunk" ? { phase: "final_answer" } : {}),
        ...(isUser
          ? {
              content: [
                {
                  type: "text",
                  text: `${previous?.content?.find((part) => part.type === "text")?.text ?? ""}${update.content.text}`,
                },
              ],
            }
          : {}),
        text: `${previous?.text ?? ""}${update.content.text}`,
      });
      if (isUser) replay.currentUserItemId = id;
      else replay.currentAgentItemId = id;
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text" && update.content.text) {
      const turnId = replay.currentTurnId;
      if (!turnId) return;
      replay.currentAgentItemId = null;
      const id = `${turnId}:thought`;
      const previous = replay.itemsById.get(id);
      replay.itemsById.set(id, {
        ...(previous ?? {}),
        id,
        type: "agentMessage",
        phase: "commentary",
        text: `${previous?.text ?? ""}${update.content.text}`,
      });
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const turnId = replay.currentTurnId;
      if (!turnId) return;
      replay.currentAgentItemId = null;
      const previous = replay.itemsById.get(update.toolCallId);
      if (!previous) this.#flushHistoryItems(replay);
      if (replay.stopped || replay.error) return;
      if (!previous && replay.itemsById.size >= ACP_HISTORY_REPLAY_QUEUE_LIMIT) {
        this.#abortHistoryReplay(replay, new Error("ACP history replay has too many active items."));
        return;
      }
      const status = update.status ?? previous?.status;
      const item: ThreadItem = {
        ...(previous ?? {}),
        id: update.toolCallId,
        type: "toolCall",
        name: update.name ?? update.title ?? previous?.name,
        toolKind: update.kind ?? previous?.toolKind,
        ...(status === undefined ? {} : { status }),
        arguments: update.rawInput ?? previous?.arguments,
        result: update.rawOutput ?? previous?.result,
      };
      replay.itemsById.set(update.toolCallId, item);
      if (update.status === "completed" || update.status === "failed") {
        this.#flushHistoryItem(replay, update.toolCallId);
      }
    }
  }

  #finishHistoryTurn(replay: HistoryReplay): boolean {
    const turnId = replay.currentTurnId;
    if (!turnId) return false;
    this.#flushHistoryItems(replay);
    this.#enqueueHistoryFragment(replay, {
      turnId,
      ...(replay.currentTurnStartedAt === undefined ? {} : { startedAt: replay.currentTurnStartedAt }),
      recordsOnly: true,
      items: [],
      complete: true,
    });
    replay.itemsById.clear();
    replay.currentTurnId = null;
    replay.currentUserMessageId = null;
    replay.currentUserItemId = null;
    replay.currentAgentItemId = null;
    replay.turnHasOutput = false;
    replay.currentTurnStartedAt = undefined;
    return true;
  }

  #flushHistoryItem(replay: HistoryReplay, id: string): void {
    const item = replay.itemsById.get(id);
    if (!item || !replay.currentTurnId) return;
    replay.itemsById.delete(id);
    this.#enqueueHistoryFragment(replay, {
      turnId: replay.currentTurnId,
      ...(replay.currentTurnStartedAt === undefined ? {} : { startedAt: replay.currentTurnStartedAt }),
      recordsOnly: true,
      items: [item],
      complete: false,
    });
  }

  #flushHistoryItems(replay: HistoryReplay): void {
    for (const id of replay.itemsById.keys()) {
      if (replay.stopped || replay.error) return;
      this.#flushHistoryItem(replay, id);
    }
  }

  readonly #sessionListingEffect = Effect.fn("AcpAgentClient.sessionListing")(function* (
    this: AcpAgentClient,
    connection: ClientSideConnection,
    request: LoadSessionRequest,
  ): Effect.fn.Return<"listed" | "absent" | "unknown", ProviderClientOperationError> {
    if (!this.#initialization?.agentCapabilities?.sessionCapabilities?.list) return "unknown";
    let cursor: string | undefined;
    try {
      for (let page = 0; page < SESSION_LIST_PAGES; page += 1) {
        const response = providerResult(
          yield* Effect.result(
            providerCall(() => connection.listSessions({ cwd: request.cwd, ...(cursor ? { cursor } : {}) })),
          ),
        );
        if (response.sessions.some((session) => session.sessionId === request.sessionId)) return "listed";
        cursor = response.nextCursor ?? undefined;
        if (!cursor) return "absent";
      }
    } catch {
      return "unknown";
    }
    return "unknown";
  });

  readonly #startTurnEffect = Effect.fn("AcpAgentClient.startTurn")(function* (
    this: AcpAgentClient,
    params: unknown,
  ): Effect.fn.Return<{ turn: { id: string; status: string }; turnId?: string }, ProviderClientOperationError> {
    const threadId = yield* providerSync(() => requiredString(params, "threadId"));
    return yield* this.#threads
      .startTurn(threadId, () => this.#openTurn(threadId, params))
      .pipe(toProviderClientOperationError);
  });

  readonly #openTurn = Effect.fn("AcpAgentClient.openTurn")(function* (
    this: AcpAgentClient,
    threadId: string,
    params: unknown,
  ): Effect.fn.Return<{ turn: { id: string; status: string }; turnId?: string }, ProviderClientOperationError> {
    this.#openingTurns.set(threadId, (this.#openingTurns.get(threadId) ?? 0) + 1);
    return yield* this.#prepareTurn(threadId, params).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const count = (this.#openingTurns.get(threadId) ?? 1) - 1;
          if (count > 0) this.#openingTurns.set(threadId, count);
          else this.#openingTurns.delete(threadId);
        }),
      ),
    );
  });

  readonly #prepareTurn = Effect.fn("AcpAgentClient.prepareTurn")(function* (
    this: AcpAgentClient,
    threadId: string,
    params: unknown,
  ): Effect.fn.Return<{ turn: { id: string; status: string }; turnId?: string }, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    for (;;) {
      const reading = this.#historyReplays.get(threadId);
      if (!reading) break;
      const ended = yield* Effect.promise(() => reading.ended).pipe(
        Effect.timeoutOption(this.options.turnStallMs ?? ACP_TURN_STALL_MS),
      );
      if (Option.isNone(ended)) break;
    }
    let thread = yield* providerSync(() => this.#requireThread(threadId));
    if (thread.backgroundReplay) yield* Deferred.await(thread.backgroundReplay);
    if (thread.needsResume && !thread.activeTurn) {
      yield* this.#reopenThread(thread);
      thread = yield* providerSync(() => this.#requireThread(threadId));
    }
    if (thread.activeTurn) return yield* providerFailure(this.#turnActiveError(thread.activeTurn));
    yield* this.#applyTurnSettings(thread, params, true);
    this.#publishSessionSettings(thread);
    const turnId = getString(params, "clientTurnId") ?? getString(params, "clientUserMessageId") ?? randomUUID();
    const blocks = yield* promptBlocksEffect(params, this.#acceptsAudio);
    yield* providerSync(() => this.#requireServedModel(thread));
    thread.promptsSinceInstructions += 1;
    const first = blocks[0];
    const command = first?.type === "text" && SLASH_COMMAND.test(first.text);
    const sendInstructions =
      !command &&
      thread.developerInstructions &&
      (thread.instructionsSent !== thread.developerInstructions ||
        (thread.contextUsed === null && thread.promptsSinceInstructions > ACP_INSTRUCTIONS_REFRESH_PROMPTS));
    if (sendInstructions) this.#turnContext.resend(thread.id);
    blocks.unshift(...this.#turnContext.take(thread.id, command).map((text) => ({ type: "text" as const, text })));
    if (sendInstructions) {
      blocks.unshift({
        type: "text",
        text: `<openbot-developer-instructions>\n${thread.developerInstructions}\n</openbot-developer-instructions>`,
      });
      thread.instructionsSent = thread.developerInstructions;
      thread.promptsSinceInstructions = 1;
    }
    const turn = this.#beginTurn(thread, turnId, {
      unprompted: false,
      answerOptional: isRecord(params) && params.answerOptional === true,
    });
    turn.task = yield* Effect.forkIn(this.#consumePrompt(thread, turn, blocks, params), this.#scope, {
      startImmediately: true,
    });
    yield* Effect.forkIn(this.#watchStall(thread, turn), this.#scope);
    return { turn: { id: turn.id, status: "inProgress" } };
  });

  readonly #applyTurnSettings = Effect.fn("AcpAgentClient.applyTurnSettings")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    params: unknown,
    requireModel = false,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    yield* this.#configuration.applyConfig(
      thread,
      this.#requestedModel(params),
      getString(params, "effort"),
      this.#models,
      requireModel,
    );
    const overrides = getRecord(params, "sessionSettings");
    for (const [configId, value] of Object.entries(overrides ?? {})) {
      if (typeof value !== "boolean" && typeof value !== "string")
        return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingInvalid")));
      const option = this.#configuration
        .sessionSettings(thread.configOptions)
        .options.find((entry) => entry.id === configId);
      const available =
        option?.type === "boolean"
          ? typeof value === "boolean"
          : option?.type === "select" &&
            typeof value === "string" &&
            option.options.some((choice) => choice.value === value);
      if (available && option?.currentValue !== value) yield* this.#configuration.set(thread, configId, value);
    }
  });

  #turnActiveError(turn: AcpTurn): Error {
    return turn.unprompted || turn.wake
      ? new ProviderTurnActiveError(this.#label)
      : new Error("The ACP thread already has an active turn.");
  }

  #beginTurn(
    thread: AcpThread,
    turnId: string,
    {
      unprompted,
      answerOptional,
      wake = false,
    }: {
      unprompted: boolean;
      answerOptional: boolean;
      wake?: boolean;
    },
  ): AcpTurn {
    const currentSecond = Date.now() / 1_000;
    const startedAt = Math.max(currentSecond, this.#lastTurnStartedAt + 0.001);
    this.#lastTurnStartedAt = startedAt;
    const turn: AcpTurn = {
      id: turnId,
      startedAt,
      itemId: `${turnId}:assistant`,
      thoughtItemId: `${turnId}:thought`,
      text: "",
      thought: "",
      thoughtStarted: false,
      receivedOutput: false,
      reasoned: false,
      showedPlanOrCompaction: false,
      interruptedAnswer: null,
      providerError: null,
      signInLost: false,
      failureCause: null,
      accountLink: null,
      sessionLost: false,
      sdkFailureAt: null,
      retryNotices: "",
      textToolCallAt: null,
      answerPaused: false,
      answerOptional,
      messages: [],
      toolNames: new Map(),
      toolKinds: new Map(),
      mediaKinds: new Map(),
      toolItems: new Map(),
      approvedEdits: [],
      approvedEditRuns: new Map(),
      approvedEditsRan: new Set(),
      repeatedFailure: null,
      quietNoUpdate: false,
      stopped: false,
      stop: new AbortController(),
      completing: false,
      task: null,
      steerReplies: [],
      lastPrompt: null,
      steerLock: Semaphore.makeUnsafe(1),
      lastActivityAt: Date.now(),
      modelRetries: 0,
      answered: false,
      waitingOnUser: 0,
      abandoned: false,
      reportedCost: null,
      unprompted,
      textMessageId: null,
      textMessageStart: 0,
      messageChunks: 0,
      lastChunkAt: null,
      wake,
      beforeWakeEcho: wake ? [] : null,
    };
    thread.activeTurn = turn;
    this.#threads.holdForTurn(thread);
    this.emit("notification", {
      method: "turn/started",
      params: {
        threadId: thread.id,
        turn: { id: turn.id, status: "inProgress" },
        ...(unprompted || wake ? { unprompted: true } : {}),
      },
    });
    return turn;
  }

  #requestedModel(params: unknown): string | null {
    const model = getString(params, "model");
    return model !== null && this.options.encodesModelIds ? providerModelValue(model) : model;
  }

  #requireServedModel(thread: AcpThread): void {
    const model = thread.currentModelId;
    if (!model || !this.options.servesModel) return;
    if (!this.options.servesModel(model)) {
      throw new Error(sourceText("error.agent.endpointRemoved"));
    }
  }

  readonly #consumePrompt = Effect.fn("AcpAgentClient.consumePrompt")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    prompt: ContentBlock[],
    params: unknown,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    try {
      let sentAt = 0;
      let promptedAgain = false;
      const send = () =>
        Effect.suspend(() => {
          sentAt = Date.now();
          return this.#sendPrompt(thread, turn, prompt, params);
        });
      let sent = yield* send();
      if (
        Result.isFailure(sent) &&
        thread.activeTurn === turn &&
        !turn.stopped &&
        (yield* this.#discardLostTurns(thread.id, sent.failure.cause)) &&
        this.#flavor.lostTurns?.unsent.test(failureText(sent.failure.cause)) &&
        thread.activeTurn === turn &&
        !turn.stopped
      )
        sent = yield* send();
      if (
        Result.isFailure(sent) &&
        this.#flavor.staleSession?.(sent.failure.cause) &&
        this.#closesSessions &&
        this.#supportsSessionResume &&
        thread.activeTurn === turn &&
        !turn.stopped
      )
        sent = yield* this.#sendAfterStaleSession(thread, turn, params, send);
      let response = providerResult(sent);
      if (!thread.transport) this.#promptAnswered = true;
      while (providerResult(yield* Effect.result(this.#leaveOutFailedMcpServer(thread, turn, response, params))))
        response = providerResult(yield* send());
      if (thread.activeTurn !== turn || turn.completing) return;
      const cancelledUnstarted = () =>
        response.stopReason === "cancelled" && !turn.stopped && !turn.answered && turn.failureCause === null;
      if (cancelledUnstarted()) {
        this.#reportPromptUsage(thread, turn, response);
        turn.lastActivityAt = Date.now();
        response = providerResult(yield* send());
        if (thread.activeTurn !== turn || turn.completing) return;
        if (cancelledUnstarted() && !turn.answerOptional) {
          this.#reportPromptUsage(thread, turn, response);
          turn.failureCause = "cancelled";
          yield* this.#completeTurn(
            thread,
            turn,
            "failed",
            sourceText("error.agent.promptCancelled", { provider: this.#providerName(thread) }),
          );
          return;
        }
      }
      let staleWake = false;
      for (;;) {
        for (let steer = turn.steerReplies.shift(); steer; steer = turn.steerReplies.shift()) {
          promptedAgain = true;
          const run = this.#flavor.promptRun?.(response);
          if (run === undefined) this.#reportPromptUsage(thread, turn, response);
          const reply = yield* Deferred.await(steer);
          if (run !== undefined && !(Result.isSuccess(reply) && this.#flavor.promptRun?.(reply.success) === run))
            this.#reportPromptUsage(thread, turn, response);
          if (thread.activeTurn !== turn || turn.completing) return;
          response = providerResult(reply);
        }
        const running: string = response.stopReason === "end_turn" && !staleWake ? this.#backgroundCommands(turn) : "";
        if (!running) break;
        const wake = yield* this.#awaitSessionChange(thread, turn);
        if (thread.activeTurn !== turn || turn.completing) return;
        if (wake === "steered") continue;
        if (wake === "none") break;
        this.#reportPromptUsage(thread, turn, response);
        response = providerResult(
          yield* this.#sendPrompt(thread, turn, [{ type: "text", text: BACKGROUND_WAKE_NOTE }], params),
        );
        if (thread.activeTurn !== turn || turn.completing) return;
        turn.lastActivityAt = Date.now();
        staleWake = this.#backgroundCommands(turn) === running;
        promptedAgain = true;
      }
      this.#reportPromptUsage(thread, turn, response);
      const emptyAnswerFailure =
        response.stopReason === "end_turn" && !turn.receivedOutput && !turn.answerOptional && !turn.stopped
          ? (this.#flavor.emptyAnswerFailure?.(turn, this.#label) ?? null)
          : null;
      const savedSignInCheck = emptyAnswerFailure === null ? undefined : this.options.savedSignInCheck;
      const refusal = savedSignInCheck ? yield* savedSignInCheck.refusedAfterEmptyAnswer(thread.currentModelId) : null;
      if (savedSignInCheck && (thread.activeTurn !== turn || turn.completing)) return;
      if (emptyAnswerFailure !== null && !turn.stopped) {
        if (refusal !== null) {
          logger.warn("An ACP agent's server refused its saved sign-in.", { provider: this.provider, refusal });
          turn.failureCause = "authentication";
          yield* this.#completeTurn(thread, turn, "failed", this.options.signInMessage);
          if (refusal === "turn") return;
          this.#signedIn = false;
          yield* this.#endAgentProcess(this.options.signInMessage);
          return;
        }
        turn.failureCause = "empty_answer";
        yield* this.#completeTurn(thread, turn, "failed", emptyAnswerFailure);
        return;
      }
      const sdkHarness = this.#flavor.sdkHarness;
      const textToolCallAt = turn.textToolCallAt;
      if (
        sdkHarness &&
        !turn.providerError &&
        !turn.stopped &&
        response.stopReason === "end_turn" &&
        turn.sdkFailureAt === null &&
        textToolCallAt !== null &&
        sdkHarness.textToolCall?.whole.test(turn.text.slice(textToolCallAt))
      ) {
        if (!turn.answerOptional) {
          turn.failureCause = "empty_answer";
          turn.providerError = sourceText("error.provider.acpNoAnswer", { provider: this.#label });
        }
      } else if (sdkHarness && !turn.providerError && !turn.stopped && response.stopReason === "end_turn") {
        if (turn.retryNotices) {
          turn.sdkFailureAt ??= turn.text.length;
          turn.text += turn.retryNotices;
          turn.retryNotices = "";
        }
        const failureAt = turn.sdkFailureAt ?? (sdkHarness.answerIsFailure.test(turn.text) ? 0 : null);
        const failure = failureAt === null ? "" : turn.text.slice(failureAt).trim();
        if (failureAt !== null) {
          const detail = failure || turn.text.trim();
          turn.text = failure ? turn.text.slice(0, failureAt) : "";
          if (!((turn.receivedOutput || turn.answerOptional) && sdkHarness.emptyOutputFailure?.test(detail))) {
            turn.accountLink = sdkHarness.accountLink?.(detail, this.options.argv, thread.id) ?? null;
            const rawCause = classifyFailure(detail);
            turn.failureCause =
              turn.accountLink || sdkHarness.accountVerification?.test(detail)
                ? "authentication"
                : rawCause === "unknown"
                  ? (sdkHarness.fallbackCause?.(detail) ?? rawCause)
                  : rawCause;
            turn.providerError =
              this.#mcpLoadFailureMessage(thread, detail) ??
              this.options.savedKeyLimitMessage?.(detail) ??
              sdkHarness.turnFailure(detail);
            turn.sessionLost = sdkHarness.sessionLost?.test(detail) === true;
          }
        }
      }
      if (!thread.mcpListed) thread.mcpListed = this.#listedInTime(thread.mcp, sentAt);
      if (
        !thread.mcpListed &&
        !promptedAgain &&
        !turn.wake &&
        !turn.providerError &&
        !turn.stopped &&
        response.stopReason === "end_turn"
      ) {
        turn.failureCause = "unknown";
        turn.providerError = sourceText("error.provider.acpToolsNotLoaded", { provider: this.#label });
        thread.needsResume = true;
      }
      const status =
        turn.stopped || response.stopReason === "cancelled"
          ? "interrupted"
          : response.stopReason === "end_turn"
            ? turn.providerError
              ? "failed"
              : "completed"
            : "failed";
      yield* this.#completeTurn(
        thread,
        turn,
        status,
        status === "failed" ? (turn.providerError ?? response.stopReason) : null,
      );
      if (turn.signInLost)
        yield* this.#endAgentProcess(sourceText("error.provider.acpSignInLost", { provider: this.#label }));
    } catch (error) {
      const transport = thread.transport;
      const serverLost = !turn.stopped && !transport && this.#flavor.serverLost?.(error) === true;
      const failure = serverLost
        ? yield* this.#transport
            .explainEnd(error, this.#transport.ended, true)
            .pipe(Effect.catch(() => Effect.succeed(error)))
        : transport && !turn.stopped
          ? (yield* this.#explainSessionEnd(transport, error)).cause
          : error;
      if (serverLost && !turn.stopped && failure instanceof AgentProcessExitError) return;
      if (!turn.stopped && this.#flavor.emptyAnswerError?.test(failureText(failure))) {
        if (turn.answerOptional) {
          yield* this.#completeTurn(thread, turn, "completed", null);
          return;
        }
        turn.failureCause = "empty_answer";
        yield* this.#completeTurn(
          thread,
          turn,
          "failed",
          sourceText("error.provider.acpNoAnswer", { provider: this.#label }),
        );
        return;
      }
      yield* this.#completeTurn(thread, turn, turn.stopped ? "interrupted" : "failed", turn.stopped ? null : failure);
      if (!turn.stopped && !transport) {
        if (this.#flavor.refusesUntilRestart?.(failure))
          yield* this.#endFailingProcess(
            thread.id,
            sourceText("error.provider.acpRefusedUntilRestart", { provider: this.#label }),
            true,
          );
        else if (this.#flavor.lostServerUntilRestart?.(failure))
          yield* this.#endFailingProcess(thread.id, this.#serverLostEnd(), false);
      }
    }
  });

  #endFailingProcess(threadId: string, message: string, answeredFirst: boolean): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (
        (answeredFirst && !this.#promptAnswered) ||
        this.#startingThreads.size > 0 ||
        [...this.#openingTurns.keys()].some((id) => id !== threadId) ||
        [...this.#threads.ids()].some((id) => id !== threadId && this.#threads.get(id)?.activeTurn)
      )
        return Effect.void;
      this.#promptAnswered = false;
      return this.#endAgentProcess(message);
    });
  }

  #serverLostEnd(): string {
    return sourceText("error.provider.acpServerLostEnded", { provider: this.#label });
  }

  #reportPromptUsage(thread: AcpThread, turn: AcpTurn, response: PromptResponse): void {
    const usage = this.#flavor.promptUsage ? this.#flavor.promptUsage(response) : response.usage;
    if (!usage) return;
    this.emit("notification", {
      method: "openbot/usage",
      params: {
        threadId: thread.id,
        turnId: turn.id,
        promptId: randomUUID(),
        usage,
        ...(turn.reportedCost === null ? {} : { cost: turn.reportedCost }),
      },
    });
  }

  #backgroundCommands(turn: AcpTurn): string {
    const failed =
      turn.providerError !== null ||
      turn.sdkFailureAt !== null ||
      this.#flavor.sdkHarness?.answerIsFailure.test(turn.text) === true;
    if (!this.#flavor.wakesAfterPromptEnds || !this.#steersByPrompt || turn.stopped || turn.quietNoUpdate || failed)
      return "";
    return [...turn.toolItems.values()]
      .filter(
        (item) =>
          item.toolKind === "execute" &&
          item.status === "in_progress" &&
          !(isRecord(item.arguments) && item.arguments.IsDaemon === true),
      )
      .map((item) => item.id)
      .join("\n");
  }

  readonly #awaitSessionChange = Effect.fn("AcpAgentClient.awaitSessionChange")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
  ) {
    const until = Date.now() + ACP_BACKGROUND_WATCH_MS;
    let before: string | undefined;
    while (Date.now() < until) {
      yield* Effect.sleep(ACP_BACKGROUND_POLL_MS);
      if (thread.activeTurn !== turn || turn.completing || turn.stopped) return "none";
      if (turn.steerReplies.length > 0) return "steered";
      const read = yield* Effect.result(this.#sessionUpdatedAt(thread));
      if (Result.isFailure(read)) continue;
      if (read.success === null) return "none";
      if (before !== undefined && read.success !== before) return "changed";
      before = read.success;
    }
    return "none";
  });

  readonly #steerByPrompt = Effect.fn("AcpAgentClient.steerByPrompt")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    prompt: ContentBlock[],
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    if (thread.activeTurn !== turn || turn.stopped || turn.completing || turn.waitingOnUser > 0)
      return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
    const open = turn.lastPrompt;
    const reply = Deferred.makeUnsafe<Result.Result<PromptResponse, ProviderClientOperationError>>();
    turn.steerReplies.push(reply);
    yield* Effect.forkIn(
      this.#turnPrompt(thread, turn, prompt).pipe(Effect.flatMap((result) => Deferred.succeed(reply, result))),
      this.#scope,
      { startImmediately: true },
    );
    if (this.#flavor.steerByPromptSince === undefined || !open || Deferred.isDoneUnsafe(open)) return;
    const first = yield* Effect.raceFirst(
      Effect.raceFirst(Deferred.await(reply), Deferred.await(open).pipe(Effect.as(null))),
      Effect.sleep(ACP_STEER_ANSWER_MS).pipe(Effect.as(null)),
    );
    if (first === null || Result.isSuccess(first)) return;
    const index = turn.steerReplies.indexOf(reply);
    if (index >= 0) turn.steerReplies.splice(index, 1);
    turn.lastPrompt = open;
    logger.warn("An ACP agent refused a steer prompt. The message waits in the queue.", {
      provider: this.provider,
      cause: this.#redact(failureText(first.failure.cause)),
    });
    return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
  });

  #turnPrompt(
    thread: AcpThread,
    turn: AcpTurn,
    prompt: ContentBlock[],
  ): Effect.Effect<Result.Result<PromptResponse, ProviderClientOperationError>> {
    return Effect.suspend(() => {
      const answered = Deferred.makeUnsafe<void>();
      turn.lastPrompt = answered;
      return providerCall(() => this.#sessionConnection(thread).prompt({ sessionId: thread.id, prompt })).pipe(
        Effect.result,
        Effect.ensuring(Deferred.succeed(answered, undefined)),
      );
    });
  }

  readonly #sendPrompt = Effect.fn("AcpAgentClient.sendPrompt")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    prompt: ContentBlock[],
    params: unknown,
  ): Effect.fn.Return<Result.Result<PromptResponse, ProviderClientOperationError>> {
    const send = this.#turnPrompt(thread, turn, prompt);
    if (!this.#flavor.promptOpenForBackgroundTasks || !this.#supportsSessionResume) return yield* send;
    const limit = this.options.firstUpdateMs ?? ACP_FIRST_UPDATE_MS;
    const silent = Effect.sleep(limit).pipe(
      Effect.flatMap(() => (turn.answered || turn.stopped ? Effect.never : Effect.succeed(SILENT_PROMPT))),
    );
    for (let attempt = 1; ; attempt += 1) {
      turn.answered = false;
      const outcome = yield* Effect.raceFirst(send, silent);
      if (outcome !== SILENT_PROMPT) return outcome;
      logger.warn("An ACP agent sent nothing for a prompt.", { provider: this.provider, attempt, silentMs: limit });
      yield* providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id })).pipe(Effect.ignore);
      const resumed =
        attempt === 1
          ? yield* Effect.result(
              this.#resumeWithTurnSettings(thread, thread.restore, params).pipe(
                this.#backgroundTimeout("session/resume"),
              ),
            )
          : Result.fail(providerFailure(new Error("The prompt got no update after it was sent again.")));
      if (thread.activeTurn !== turn || turn.completing || turn.stopped)
        return Result.succeed({ stopReason: "cancelled" } satisfies PromptResponse);
      if (Result.isFailure(resumed)) {
        if (resumed.failure.cause instanceof TimeoutError)
          yield* Effect.forkIn(this.#endIfUnresponsive(thread), this.#scope);
        logger.warn("OpenBot ended a turn whose prompt got no update.", {
          provider: this.provider,
          reason: this.#redact(failureText(resumed.failure.cause)),
        });
        thread.needsResume = true;
        turn.failureCause = "stalled";
        return Result.fail(
          providerFailure(
            sourceText("error.agent.turnStalled", {
              provider: this.#providerName(thread),
            }),
          ),
        );
      }
      turn.lastActivityAt = Date.now();
    }
  });

  readonly #resumeWithTurnSettings = Effect.fn("AcpAgentClient.resumeWithTurnSettings")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    restore: AcpSessionRestore,
    params: unknown,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const model = thread.currentModelId;
    const resumedAt = Date.now();
    const restored = yield* this.#restoreSessionEffect(
      () => this.#sessionConnection(thread),
      { sessionId: thread.id, ...restore },
      "resume",
    );
    if (!thread.mcpListed) thread.mcpListed = this.#listedInTime(thread.mcp, resumedAt, Date.now() - resumedAt);
    thread.restore = restore;
    thread.configOptions = restored.configOptions ?? thread.configOptions;
    thread.currentModelId = currentModelFromSessionSetup(restored) ?? thread.currentModelId;
    yield* this.#configuration.applyConfig(thread, model, null, this.#models);
    yield* this.#applyTurnSettings(thread, params);
    this.#publishSessionSettings(thread);
  });

  readonly #sendAfterStaleSession = Effect.fn("AcpAgentClient.sendAfterStaleSession")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    params: unknown,
    send: () => Effect.Effect<Result.Result<PromptResponse, ProviderClientOperationError>>,
  ): Effect.fn.Return<Result.Result<PromptResponse, ProviderClientOperationError>> {
    logger.warn("An ACP agent refused a prompt because its session changed on disk. OpenBot opens it again.", {
      provider: this.provider,
    });
    yield* providerCall(() => this.#sessionConnection(thread).closeSession({ sessionId: thread.id })).pipe(
      this.#backgroundTimeout("session/close"),
      Effect.ignore,
    );
    const reopened = yield* Effect.result(
      this.#resumeWithTurnSettings(thread, thread.restore, params).pipe(this.#backgroundTimeout("session/resume")),
    );
    if (thread.activeTurn !== turn || turn.stopped)
      return Result.succeed({ stopReason: "cancelled" } satisfies PromptResponse);
    if (Result.isSuccess(reopened)) {
      const sent = yield* send();
      if (Result.isSuccess(sent) || !this.#flavor.staleSession?.(sent.failure.cause)) return sent;
    } else {
      thread.needsResume = true;
      logger.warn("OpenBot could not open again a session that changed on disk.", {
        provider: this.provider,
        reason: this.#redact(failureText(reopened.failure.cause)),
      });
    }
    return Result.fail(
      providerFailure(sourceText("error.provider.acpSessionStale", { provider: this.#providerName(thread) })),
    );
  });

  readonly #discardLostTurns = Effect.fn("AcpAgentClient.discardLostTurns")(function* (
    this: AcpAgentClient,
    sessionId: string,
    error: unknown,
  ): Effect.fn.Return<boolean> {
    const lostTurns = this.#flavor.lostTurns;
    if (!lostTurns || !(error instanceof RequestError) || !lostTurns.refusal.test(failureText(error))) return false;
    const transport = this.#threads.get(sessionId)?.transport ?? this.#transport;
    const discarded = yield* Effect.result(transport.run(lostTurns.discard(sessionId), this.#requestTimeoutMs));
    if (Result.isFailure(discarded)) {
      logger.warn("OpenBot could not discard the turns that an ACP agent lost.", {
        provider: this.provider,
        reason: this.#redact(failureText(discarded.failure.cause)),
      });
      return false;
    }
    logger.info("OpenBot discarded the turns that an ACP agent lost.", { provider: this.provider });
    return true;
  });

  readonly #leaveOutFailedMcpServer = Effect.fn("AcpAgentClient.leaveOutFailedMcpServer")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    response: PromptResponse,
    params: unknown,
  ): Effect.fn.Return<boolean, ProviderClientOperationError> {
    if (
      !this.#flavor.sdkHarness ||
      thread.activeTurn !== turn ||
      turn.completing ||
      turn.stopped ||
      response.stopReason !== "end_turn" ||
      turn.sdkFailureAt !== 0 ||
      turn.thoughtStarted ||
      turn.toolItems.size > 0 ||
      !this.#supportsSessionResume
    )
      return false;
    const failed = this.#failedMcpServer(thread, turn, turn.text);
    if (!failed) return false;
    const { server, detail, started } = failed;
    thread.leftOutMcpServers.set(server, turn.id);
    this.#reportFailedMcpServer(thread.cwd, server.name, detail);
    const stale = thread.transport;
    if (started && stale) {
      const transport = yield* this.#startSessionProcess(() => thread);
      this.#openingSessionProcesses.delete(transport);
      thread.transport = transport;
      yield* stale.stop(Effect.void).pipe(Effect.ignore);
    }
    const restore = { ...thread.restore, mcpServers: thread.restore.mcpServers.filter((entry) => entry !== server) };
    yield* this.#resumeWithTurnSettings(thread, restore, params).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          if (started && stale) thread.needsResume = true;
        }),
      ),
    );
    turn.text = "";
    turn.sdkFailureAt = null;
    turn.textToolCallAt = null;
    turn.receivedOutput = false;
    turn.textMessageId = null;
    turn.textMessageStart = 0;
    turn.messageChunks = 0;
    turn.lastChunkAt = null;
    return true;
  });

  #failedMcpServer(
    thread: AcpThread,
    turn: AcpTurn,
    text: string,
  ): { server: McpServer; detail: string; started: boolean } | undefined {
    const harness = this.#flavor.sdkHarness;
    const given = thread.restore.mcpServers.filter((entry) => !thread.mcp.servers.some((bridge) => bridge === entry));
    const failure = harness?.mcpLoadFailure(text);
    if (failure) {
      const server = given.find((entry) => entry.name === failure.name);
      const detail = sourceText("error.backend.mcpServerFailedToStart", { reason: failure.reason });
      return server && { server, detail, started: false };
    }
    const refusable = [...given];
    for (const [server, turnId] of thread.leftOutMcpServers) if (turnId !== turn.id) refusable.push(server);
    if (refusable.length === 0 || !harness?.refusedMcpTools) return undefined;
    const names = [...refusable.map((entry) => entry.name), ...this.#ownMcpServerNames(thread.cwd)];
    for (const tool of harness.refusedMcpTools(text, this.options.argv, thread.id)) {
      const name = names
        .filter((candidate) => tool.startsWith(`mcp_${candidate}_`))
        .sort((a, b) => b.length - a.length)[0];
      const server = refusable.find((entry) => entry.name === name);
      if (server) {
        const shown = tool.slice(`mcp_${server.name}_`.length);
        return { server, detail: sourceText("error.backend.mcpToolSchemaRefused", { tool: shown }), started: true };
      }
    }
    return undefined;
  }

  #reportMcpServerFailure(thread: AcpThread, { name, reason }: AcpMcpServerFailure): void {
    const server = thread.restore.mcpServers.find((entry) => entry.name === name);
    if (!server) return;
    if (thread.mcp.servers.some((bridge) => bridge === server)) {
      this.emit("diagnostic", this.#redact(`${this.#label} could not start OpenBot's MCP server ${name}: ${reason}`));
      return;
    }
    const kind = mcpProviderFailureKind(reason);
    if (kind !== "sign_in" && kind !== "timeout") {
      this.#reportFailedMcpServer(thread.cwd, name, sourceText("error.backend.mcpServerFailedToStart", { reason }));
      return;
    }
    const saved = this.#savedMcpServerName(thread.cwd, name);
    logger.warn("An ACP agent could not start an MCP server.", {
      provider: this.provider,
      server: saved,
      reason: this.#redact(reason),
    });
    this.options.reportMcpDrops?.(this.provider, [
      {
        name: saved,
        reason: "failed_in_provider",
        detail: sourceText(MCP_PROVIDER_FAILURE_TEXT[kind], {
          provider: agentProviderName(this.provider),
          name: saved,
        }),
      },
    ]);
  }

  #reportFailedMcpServer(cwd: string, name: string, detail: string): void {
    this.options.reportMcpDrops?.(this.provider, [
      { name: this.#savedMcpServerName(cwd, name), reason: "failed_to_start", detail },
    ]);
  }

  #savedMcpServerName(cwd: string, name: string): string {
    const own = this.#ownMcpServerNames(cwd);
    const configured = this.options
      .mcpServers?.()
      .find((config) => acpMcpServerName(config, own, this.#flavor.mcpServerName) === name);
    return configured?.name ?? name;
  }

  #ownMcpServerNames(cwd: string): readonly string[] {
    return this.#flavor.ownMcpServerNames?.(cwd, this.options.argv) ?? [];
  }

  #mcpLoadFailureMessage(thread: AcpThread, detail: string): string | null {
    const failure = this.#flavor.sdkHarness?.mcpLoadFailure(detail);
    if (!failure || thread.mcp.servers.some((bridge) => bridge.name === failure.name)) return null;
    this.emit("diagnostic", this.#redact(detail));
    const own = this.#ownMcpServerNames(thread.cwd);
    const configured = this.options
      .mcpServers?.()
      .find((config) => acpMcpServerName(config, own, this.#flavor.mcpServerName) === failure.name);
    return configured
      ? sourceText("error.backend.mcpServerFailedForProvider", { provider: this.#label, name: configured.name })
      : sourceText("error.provider.acpOwnMcpServerFailed", { provider: this.#label, name: failure.name });
  }

  #sessionUpdate(notification: SessionNotification): void {
    if (notification.sessionId === this.#privateSession?.sessionId) {
      const update = notification.update;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
        this.#privateAnswer?.push(update.content.text);
      return;
    }
    const replay = this.#historyReplays.get(notification.sessionId);
    if (replay) {
      this.#historyUpdate(replay, notification);
      return;
    }
    const background = this.#backgroundReplays.get(notification.sessionId);
    if (background) {
      background.push(notification.update);
      return;
    }
    const thread = this.#threads.get(notification.sessionId);
    if (!thread) return;
    const update = notification.update;
    const active = thread.activeTurn;
    if (active && !this.#flavor.modelRetryUpdate?.(update)) {
      active.lastActivityAt = Date.now();
      active.modelRetries = 0;
    } else if (active && ++active.modelRetries === 1) {
      active.lastActivityAt = Date.now();
    }
    if (update.sessionUpdate === "config_option_update") {
      thread.configOptions = update.configOptions;
      this.#publishSessionSettings(thread);
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      if (thread.contextUsed !== null && update.used < thread.contextUsed * ACP_COMPACTION_CONTEXT_RATIO)
        this.#compacted(thread);
      thread.contextUsed = update.used;
      const cost = update.cost;
      if (thread.activeTurn && cost?.currency === "USD" && Number.isFinite(cost.amount) && cost.amount >= 0)
        thread.activeTurn.reportedCost = cost.amount;
      if (Number.isFinite(update.used) && update.used >= 0 && Number.isFinite(update.size) && update.size > 0)
        this.emit("notification", {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: thread.id,
            tokenUsage: { last: { totalTokens: update.used }, modelContextWindow: update.size },
          },
        });
      return;
    }
    if (update.sessionUpdate === "compaction_update") {
      if (update.status === "completed") this.#compacted(thread);
      return;
    }
    const turn = thread.activeTurn;
    if (!turn || turn.completing) return;
    if (turn.beforeWakeEcho) {
      if (update.sessionUpdate === "user_message_chunk" && update.content.type === "text") {
        if (isTurnContextBlock(update.content.text)) turn.beforeWakeEcho = null;
      } else if (!SESSION_STATE_UPDATES.has(update.sessionUpdate)) {
        turn.answered = true;
        turn.beforeWakeEcho.push(update);
      }
      return;
    }
    const retry = turn.stopped ? null : this.#flavor.retryUpdate?.(update);
    if (retry) {
      turn.retrying = "model";
      this.#emitTurnProgress(
        thread,
        turn,
        sourceText(MODEL_RETRY_STATUS[retry.cause], { provider: this.#label, attempt: retry.attempt }),
      );
    }
    if (turn.retrying && !SESSION_STATE_UPDATES.has(update.sessionUpdate)) {
      const recovered =
        turn.retrying === "model"
          ? sourceText("status.provider.modelRetryRecovered")
          : sourceText("status.provider.retryRecovered", { provider: this.#providerName(thread) });
      delete turn.retrying;
      this.#emitTurnProgress(thread, turn, recovered);
    }
    this.#applyTurnUpdate(thread, turn, update);
  }

  #emitTurnProgress(thread: AcpThread, turn: AcpTurn, detail: string): void {
    this.emit("notification", {
      method: "openbot/turn-progress",
      params: { threadId: thread.id, turnId: turn.id, detail },
    });
  }

  #providerName(thread: AcpThread): string {
    return this.options.customEndpoint?.(thread.currentModelId)?.name ?? this.#label;
  }

  #applyTurnUpdate(thread: AcpThread, turn: AcpTurn, update: SessionUpdate): void {
    if (!SESSION_STATE_UPDATES.has(update.sessionUpdate)) turn.answered = true;
    const text =
      update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? update.content.text : null;
    const attempt = text === null ? null : (this.#flavor.sdkHarness?.retryNotice?.(text) ?? null);
    if (text !== null && attempt !== null) {
      turn.retryNotices += text;
      this.#emitTurnProgress(
        thread,
        turn,
        sourceText("status.provider.modelRetryServerError", { provider: this.#label, attempt }),
      );
      return;
    }
    if (turn.retryNotices && !SESSION_STATE_UPDATES.has(update.sessionUpdate)) {
      const notices = turn.retryNotices;
      turn.retryNotices = "";
      if (text !== null && this.#flavor.sdkHarness?.answerIsFailure.test(`\n${text.replace(/^\n+/u, "")}`)) {
        turn.sdkFailureAt ??= turn.text.length;
        turn.text += notices;
      } else this.#emitTurnProgress(thread, turn, sourceText("status.provider.modelRetryRecovered"));
    }
    if (this.#flavor.unsentBackgroundTurns) {
      const id = shownEntryId(update);
      if (id) thread.shownIds.add(id);
    }
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      if (this.#flavor.noiseChunk?.test(update.content.text)) return;
      if (this.#flavor.signInLostChunk?.test(update.content.text)) {
        turn.receivedOutput = true;
        turn.signInLost = true;
        turn.failureCause = "authentication";
        turn.providerError = sourceText("error.provider.acpSignInLost", { provider: this.#label });
        return;
      }
      if (this.#flavor.planUsedUpChunk?.test(update.content.text)) {
        turn.receivedOutput = true;
        turn.failureCause = "usage_limit";
        turn.providerError = sourceText("error.provider.acpPlanUsedUp", { provider: this.#label });
        return;
      }
      if (this.#flavor.connectionLostChunk?.test(update.content.text)) {
        turn.receivedOutput = true;
        turn.failureCause = "network";
        turn.providerError = sourceText("error.provider.acpServerLost", { provider: this.#label });
        return;
      }
      const quota = this.#flavor.sdkHarness?.quota(update.content.text) ?? null;
      if (quota !== null) {
        turn.receivedOutput = true;
        turn.failureCause = "usage_limit";
        turn.providerError = quota;
        return;
      }
      if (this.#flavor.resumesAnswerAfterThought?.report.test(update.content.text)) {
        turn.receivedOutput = true;
        this.#completeThought(thread, turn);
        this.#appendThought(thread, turn, update.content.text.trim());
        this.#completeThought(thread, turn);
        return;
      }
      if (HARNESS_ERROR_CHUNK.test(update.content.text)) {
        const error = update.content.text.trim();
        turn.receivedOutput = true;
        turn.interruptedAnswer = [turn.text.trim() || turn.interruptedAnswer, error].filter(Boolean).join("\n\n");
        this.#completeThought(thread, turn);
        this.#completeMessage(thread, turn, "commentary");
        this.#appendThought(thread, turn, error);
        this.#completeThought(thread, turn);
        return;
      }
      if (turn.failureCause === "network" && update.content.text.trim()) {
        turn.failureCause = null;
        turn.providerError = null;
      }
      if (update.content.text) this.#completeThought(thread, turn);
      const messageId = contentMessageId(update);
      let text = update.content.text;
      if (
        this.#flavor.messagePerId &&
        text &&
        messageId &&
        turn.textMessageId &&
        messageId !== turn.textMessageId &&
        turn.text
      ) {
        text = `${turn.text.endsWith("\n\n") ? "" : turn.text.endsWith("\n") ? "\n" : "\n\n"}${text}`;
        turn.textMessageStart = turn.text.length + text.length - update.content.text.length;
      }
      if (this.#flavor.resendsAnswer && text) {
        turn.messageChunks = turn.text && messageId && messageId === turn.textMessageId ? turn.messageChunks + 1 : 1;
        turn.lastChunkAt = turn.messageChunks > 2 ? turn.text.length : null;
      }
      if (messageId && (text || !turn.textMessageId)) turn.textMessageId = messageId;
      if (
        turn.sdkFailureAt === null &&
        (this.#flavor.sdkHarness?.answerIsFailure.test(text) ||
          (!turn.text && this.#flavor.sdkHarness?.mcpLoadFailure(text)))
      )
        turn.sdkFailureAt = turn.text.length;
      const textToolCall = turn.sdkFailureAt === null ? this.#flavor.sdkHarness?.textToolCall : undefined;
      let released = "";
      if (
        textToolCall &&
        turn.textToolCallAt === null &&
        textToolCall.starts.some((start) => text.trimStart().startsWith(start))
      )
        turn.textToolCallAt = turn.text.length;
      else if (textToolCall && (turn.textToolCallAt === 0 || (turn.textToolCallAt === null && !turn.text))) {
        const message = (turn.text + text).trimStart();
        if (textToolCall.starts.some((start) => message.startsWith(start) || start.startsWith(message)))
          turn.textToolCallAt = 0;
        else if (turn.textToolCallAt === 0) {
          turn.textToolCallAt = null;
          released = turn.text;
        }
      }
      const held = turn.sdkFailureAt !== null || turn.textToolCallAt !== null;
      if (turn.answerPaused && text) {
        turn.answerPaused = false;
        if (!/\s$/u.test(turn.text) && !/^\s/u.test(text)) text = `\n${text}`;
      }
      if ((update.content.text.trim() || released.trim()) && !held) {
        turn.receivedOutput = true;
        turn.interruptedAnswer = null;
      }
      if (this.#flavor.streamAnswerBeforePromptReturns && text && !held) {
        if (!turn.text || released)
          this.emit("notification", {
            method: "item/started",
            params: {
              threadId: thread.id,
              turnId: turn.id,
              item: { id: turn.itemId, type: "agentMessage", phase: "final_answer" },
            },
          });
        this.emit("notification", {
          method: "item/agentMessage/delta",
          params: { threadId: thread.id, turnId: turn.id, itemId: turn.itemId, delta: released + text },
        });
      }
      turn.text += text;
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      if (update.content.text.trim()) turn.reasoned = true;
      this.#appendThought(thread, turn, update.content.text);
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      turn.receivedOutput = true;
      if (update.sessionUpdate === "tool_call") {
        this.#completeThought(thread, turn);
        this.#completeMessage(thread, turn, "commentary");
      }
      const name = update.name ?? update.title ?? turn.toolNames.get(update.toolCallId) ?? "tool";
      turn.toolNames.set(update.toolCallId, name);
      const toolKind = update.kind ?? turn.toolKinds.get(update.toolCallId) ?? "other";
      turn.toolKinds.set(update.toolCallId, toolKind);
      const swept = this.#isApprovedEditSweep(turn, update, toolKind);
      const reported = swept ? "completed" : update.status;
      const status = reported ?? turn.toolItems.get(update.toolCallId)?.status;
      const item: ThreadItem = {
        ...(turn.toolItems.get(update.toolCallId) ?? {}),
        id: update.toolCallId,
        type: "toolCall",
        name,
        toolKind,
        ...(status === undefined ? {} : { status }),
        arguments: update.rawInput ?? turn.toolItems.get(update.toolCallId)?.arguments,
        result: (swept ? undefined : update.rawOutput) ?? turn.toolItems.get(update.toolCallId)?.result,
        ...(reported === "failed" && update.content ? { error: update.content } : {}),
      };
      turn.toolItems.set(update.toolCallId, item);
      this.#foldSubagentTool(thread, turn, update.toolCallId, update.content, item);
      const mediaKind = this.#flavor.mediaTools?.kind(update) ?? turn.mediaKinds.get(update.toolCallId);
      if (mediaKind) turn.mediaKinds.set(update.toolCallId, mediaKind);
      const shown =
        mediaKind && this.#flavor.mediaTools ? this.#flavor.mediaTools.item(mediaKind, item, update.content) : item;
      this.emit("notification", {
        method: reported === "completed" || reported === "failed" ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          filePaths: update.locations?.map((location) => location.path),
          item: shown,
        },
      });
      if (reported === "completed" || reported === "failed") {
        if (!turn.stopped)
          this.#openQuestionToolCalls
            .get(questionToolCallKey(thread.id, update.toolCallId))
            ?.abort(PROVIDER_STOPPED_WAITING);
        turn.messages.push(shown);
        turn.toolItems.delete(update.toolCallId);
        turn.mediaKinds.delete(update.toolCallId);
        this.#countRepeatedFailure(thread, turn, reported === "failed" ? item : null);
      }
      if (this.#flavor.unsentBackgroundTurns && update.status === "completed" && startsBackgroundTask(update.rawOutput))
        this.#watchBackground(thread);
      return;
    }
    if (update.sessionUpdate === "plan") {
      turn.showedPlanOrCompaction = true;
      this.emit("notification", {
        method: PLAN_UPDATED_METHOD,
        params: { threadId: thread.id, turnId: turn.id, explanation: null, plan: acpPlanSteps(update.entries) },
      });
    }
  }

  #completeMessage(
    thread: AcpThread,
    turn: AcpTurn,
    phase: "commentary" | "final_answer",
    failureReport = false,
  ): void {
    if (phase === "final_answer") {
      if (!turn.text.trim() && turn.interruptedAnswer) turn.text = turn.interruptedAnswer;
      turn.interruptedAnswer = null;
    }
    const textToolCallAt = turn.textToolCallAt;
    if (textToolCallAt !== null) {
      const held = turn.text.slice(textToolCallAt);
      if (this.#flavor.sdkHarness?.textToolCall?.whole.test(held)) {
        turn.text = turn.text.slice(0, textToolCallAt);
        if (!turn.text.trim()) {
          this.#endMessage(turn);
          return;
        }
      } else if (held.trim() && turn.sdkFailureAt === null) {
        turn.receivedOutput = true;
        if (phase === "commentary") turn.interruptedAnswer = null;
      }
    }
    const failureAt = turn.sdkFailureAt;
    if (
      phase === "commentary" &&
      failureAt !== null &&
      (turn.receivedOutput || turn.answerOptional) &&
      this.#flavor.sdkHarness?.emptyOutputFailure?.test(turn.text.slice(failureAt))
    ) {
      turn.text = turn.text.slice(0, failureAt);
      if (!turn.text) {
        this.#endMessage(turn);
        return;
      }
    }
    if (!turn.text) return;
    const item = {
      id: turn.itemId,
      type: "agentMessage",
      phase,
      text: turn.text,
      ...(failureReport ? { failureReport: true } : {}),
    } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    this.#endMessage(turn);
  }

  #endMessage(turn: AcpTurn): void {
    turn.text = "";
    turn.sdkFailureAt = null;
    turn.textToolCallAt = null;
    turn.answerPaused = false;
    turn.textMessageId = null;
    turn.textMessageStart = 0;
    turn.messageChunks = 0;
    turn.lastChunkAt = null;
    turn.itemId = `${turn.id}:assistant:${turn.messages.length}`;
  }

  #dropStreamedCopy(turn: AcpTurn): void {
    if (turn.lastChunkAt === null) return;
    const streamed = turn.text.slice(0, turn.lastChunkAt).trim();
    const last = turn.text.slice(turn.lastChunkAt);
    if (streamed && last.includes(streamed)) turn.text = last;
    turn.lastChunkAt = null;
  }

  #appendThought(thread: AcpThread, turn: AcpTurn, text: string): void {
    const resumes =
      this.#flavor.resumesAnswerAfterThought !== undefined &&
      turn.text.trim() !== "" &&
      turn.sdkFailureAt === null &&
      turn.textToolCallAt === null;
    if (resumes) turn.answerPaused = true;
    else if (!this.#flavor.thoughtsInsideAnswer) this.#completeMessage(thread, turn, "commentary");
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
    turn.thought += text;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: { threadId: thread.id, turnId: turn.id, itemId: turn.thoughtItemId, delta: text },
    });
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

  #countRepeatedFailure(thread: AcpThread, turn: AcpTurn, failed: ThreadItem | null): void {
    if (turn.unprompted) return;
    if (!failed) {
      turn.repeatedFailure = null;
      return;
    }
    const key = JSON.stringify([failed.name, failed.arguments ?? null, failed.error ?? failed.result ?? null]);
    const count = turn.repeatedFailure?.key === key ? turn.repeatedFailure.count + 1 : 1;
    turn.repeatedFailure = { key, count };
    if (count !== ACP_REPEATED_TOOL_FAILURES || turn.stopped) return;
    Effect.runFork(
      Effect.gen({ self: this }, function* () {
        turn.failureCause = "turn_limit";
        yield* providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id })).pipe(Effect.ignore);
        yield* this.#abandonTurn(
          thread,
          turn,
          "failed",
          sourceText("error.agent.toolLoopStopped", {
            provider: this.options.customEndpoint?.(thread.currentModelId)?.name ?? this.#label,
          }),
        );
      }).pipe(Effect.forkIn(this.#scope)),
    );
  }

  readonly #abandonTurn = Effect.fn("AcpAgentClient.abandonTurn")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    status: "interrupted" | "failed",
    error: string | null,
  ) {
    if (thread.activeTurn !== turn || turn.completing) return;
    if (this.#supportsSessionResume || this.#loadsSessions) thread.needsResume = true;
    turn.abandoned = true;
    if (turn.task) yield* Fiber.interrupt(turn.task);
    yield* this.#completeTurn(thread, turn, status, error);
  });

  readonly #watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
  ) {
    const agentLimit = this.options.turnStallMs ?? this.#flavor.turnStallMs ?? ACP_TURN_STALL_MS;
    const grace = this.#flavor.modelRetryUpdate ? ACP_MODEL_RETRY_GRACE : 1;
    let answeredAt = 0;
    while (thread.activeTurn === turn && !turn.completing && !turn.stopped) {
      const limit = (this.options.customEndpoint?.(thread.currentModelId)?.stallMs ?? agentLimit) * grace;
      if (this.#flavor.promptOpenForBackgroundTasks) {
        const silentFor = Date.now() - Math.max(turn.lastActivityAt, answeredAt);
        if (silentFor < limit) {
          yield* Effect.sleep(limit - silentFor);
          continue;
        }
        if (yield* this.#endIfUnresponsive(thread)) return;
        answeredAt = Date.now();
        continue;
      }
      const silentFor = Date.now() - turn.lastActivityAt;
      if (silentFor < limit || turn.toolItems.size > 0 || turn.waitingOnUser > 0) {
        yield* Effect.sleep(silentFor < limit ? limit - silentFor : limit);
        continue;
      }
      this.emit("diagnostic", `${this.#label} sent nothing for ${silentFor} ms; ending turn ${turn.id}.`);
      turn.failureCause = "stalled";
      yield* providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id })).pipe(Effect.ignore);
      yield* this.#abandonTurn(
        thread,
        turn,
        "failed",
        sourceText("error.agent.turnStalled", {
          provider: this.#providerName(thread),
        }),
      );
    }
  });

  readonly #endIfUnresponsive = Effect.fn("AcpAgentClient.endIfUnresponsive")(function* (
    this: AcpAgentClient,
    thread?: AcpThread,
  ) {
    const transport = thread?.transport ?? this.#transport;
    if (!this.#flavor.promptOpenForBackgroundTasks || this.#probing || !transport.running) return false;
    this.#probing = true;
    const hung = yield* Effect.gen({ self: this }, function* () {
      const connection = yield* providerSync(() => transport.requireConnection());
      yield* providerCall(() => connection.listSessions({ cwd: this.options.discoveryCwd?.() ?? process.cwd() })).pipe(
        this.#backgroundTimeout("session/list"),
      );
    }).pipe(
      Effect.as(false),
      Effect.catch((failure) => Effect.succeed(failure.cause instanceof TimeoutError)),
      Effect.ensuring(
        Effect.sync(() => {
          this.#probing = false;
        }),
      ),
    );
    if (!hung || !transport.running) return false;
    this.emit("diagnostic", `${this.#label} did not answer session/list in time.`);
    if (thread && transport !== this.#transport) {
      const turn = thread.activeTurn;
      const message = sourceText("error.provider.acpUnresponsive", { provider: this.#label });
      if (turn) {
        turn.failureCause = "timeout";
        yield* this.#abandonTurn(thread, turn, "failed", message);
      }
      thread.needsResume = true;
      yield* transport.stop(Effect.void).pipe(Effect.ignore);
      return true;
    }
    yield* this.#endAgentProcess(sourceText("error.provider.acpUnresponsive", { provider: this.#label }));
    return true;
  });

  #whileProcessWrites<A>(request: Effect.Effect<A, ProviderClientOperationError>) {
    const limit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;
    const startedAt = Date.now();
    const busy = () =>
      [...this.#threads.ids()].some((id) => {
        const thread = this.#threads.get(id);
        const turn = thread?.transport ? null : thread?.activeTurn;
        return turn ? turn.toolItems.size > 0 || turn.waitingOnUser > 0 : false;
      });
    const silent = Effect.gen({ self: this }, function* () {
      for (;;) {
        const silentFor = Date.now() - Math.max(startedAt, this.#transport.lastOutputAt);
        if (silentFor >= limit && !busy()) break;
        yield* Effect.sleep(silentFor < limit ? limit - silentFor : limit);
      }
      const message = sourceText("error.provider.acpUnresponsive", { provider: this.#label });
      this.emit("diagnostic", `${this.#label} wrote nothing for ${limit} ms while a session opened.`);
      yield* this.#endAgentProcess(message);
      return yield* providerFailure(new TimeoutError(message));
    });
    return Effect.raceFirst(request, silent);
  }

  #endAgentProcess(message: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.emit("exit", new Error(message));
      return Effect.forkDetach(this.stop().pipe(Effect.ignore), { startImmediately: true }).pipe(Effect.asVoid);
    });
  }

  #watchBackground(thread: AcpThread): void {
    if (!this.#loadsSessions) return;
    const watching = thread.backgroundUntil > 0;
    thread.backgroundUntil = Date.now() + ACP_BACKGROUND_WATCH_MS;
    if (watching) return;
    this.#threads.holdForTurn(thread);
    Effect.runFork(this.#watchBackgroundTurns(thread).pipe(Effect.forkIn(this.#scope)));
  }

  readonly #watchBackgroundTurns = Effect.fn("AcpAgentClient.watchBackgroundTurns")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ) {
    const stallLimit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;
    while (
      this.#threads.get(thread.id) === thread &&
      (Date.now() < thread.backgroundUntil ||
        thread.activeTurn?.unprompted === true ||
        this.#heldByBackgroundSubagent(thread))
    ) {
      yield* Effect.sleep(ACP_BACKGROUND_POLL_MS);
      const active = thread.activeTurn;
      if ((active && !active.unprompted) || this.#openingTurns.has(thread.id)) continue;
      const updatedAt = this.#backgroundSubagentRuns(thread)
        ? null
        : yield* this.#sessionUpdatedAt(thread).pipe(Effect.orElseSucceed(() => null));
      if (updatedAt !== null && updatedAt !== thread.backgroundUpdatedAt) {
        const replayed = yield* this.#replayBackground(thread).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              this.emit("diagnostic", this.#redact(`ACP background replay failed: ${failureText(error)}`));
              return false;
            }),
          ),
        );
        if (replayed) {
          thread.backgroundUpdatedAt = updatedAt;
          thread.backgroundUntil = Math.max(thread.backgroundUntil, Date.now() + ACP_BACKGROUND_WATCH_MS);
        }
      }
      const turn = thread.activeTurn;
      if (!turn?.unprompted || turn.completing || turn.waitingOnUser > 0) continue;
      const limit = turn.toolItems.size > 0 ? stallLimit : ACP_BACKGROUND_TURN_QUIET_MS;
      if (Date.now() - turn.lastActivityAt >= limit) yield* this.#completeTurn(thread, turn, "completed", null);
    }
    thread.backgroundUntil = 0;
    thread.backgroundUpdatedAt = null;
    if (this.#threads.get(thread.id) === thread && !thread.activeTurn) yield* this.#threads.markIdle(thread);
  });

  #backgroundSubagentRuns(thread: AcpThread): boolean {
    return this.#runningBackgroundSubagents(thread).length > 0;
  }

  #heldByBackgroundSubagent(thread: AcpThread): boolean {
    const since = Date.now() - ACP_WORK_HOLD_MAX_MS;
    return this.#runningBackgroundSubagents(thread).some((subagent) => Date.parse(subagent.startedAt) > since);
  }

  #runningBackgroundSubagents(thread: AcpThread) {
    return [...this.#subagentThreads]
      .filter(([, threadId]) => threadId === thread.id)
      .flatMap(([turnId]) => this.#subagents.turns.get(turnId)?.subagents ?? [])
      .filter((subagent) => subagent.background && subagent.status === "running");
  }

  readonly #sessionUpdatedAt = Effect.fn("AcpAgentClient.sessionUpdatedAt")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ) {
    const connection = yield* providerSync(() => this.#sessionConnection(thread));
    const response = yield* providerCall(() => connection.listSessions({ cwd: thread.cwd })).pipe(
      this.#backgroundTimeout("session/list"),
    );
    return response.sessions.find((session) => session.sessionId === thread.id)?.updatedAt ?? null;
  });

  readonly #replayBackground = Effect.fn("AcpAgentClient.replayBackground")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ) {
    if (
      thread.backgroundReplay ||
      this.#openingTurns.has(thread.id) ||
      (thread.activeTurn && !thread.activeTurn.unprompted)
    )
      return false;
    const done = Deferred.makeUnsafe<void>();
    const updates: SessionUpdate[] = [];
    thread.backgroundReplay = done;
    this.#backgroundReplays.set(thread.id, updates);
    const release = () => {
      if (this.#backgroundReplays.get(thread.id) === updates) this.#backgroundReplays.delete(thread.id);
      if (thread.backgroundReplay === done) thread.backgroundReplay = null;
      Deferred.doneUnsafe(done, Exit.void);
    };
    let started = false;
    let settled = false;
    let givenUp = false;
    const settle = () => {
      settled = true;
      if (givenUp) release();
    };
    yield* Effect.gen({ self: this }, function* () {
      const connection = yield* providerSync(() => this.#sessionConnection(thread));
      const load = Promise.resolve().then(() => connection.loadSession({ sessionId: thread.id, ...thread.restore }));
      started = true;
      load.then(settle, settle);
      yield* providerCall(() => load).pipe(this.#backgroundTimeout("session/load"));
      this.#applyBackgroundEntries(thread, updates);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!started || settled) release();
          else givenUp = true;
        }),
      ),
    );
    return true;
  });

  #backgroundTimeout(method: string) {
    return <A>(request: Effect.Effect<A, ProviderClientOperationError>) =>
      request.pipe(
        Effect.timeoutOrElse({
          duration: this.#requestTimeoutMs,
          orElse: () => Effect.fail(providerFailure(new TimeoutError(`${this.#label} request timed out: ${method}`))),
        }),
      );
  }

  #applyBackgroundEntries(thread: AcpThread, updates: SessionUpdate[]): void {
    const ids = updates.map(shownEntryId);
    const lastShown = ids.findLastIndex((id) => id !== null && thread.shownIds.has(id));
    if (lastShown < 0) return;
    const fresh = new Set(ids.slice(lastShown + 1).filter((id) => id !== null && !thread.shownIds.has(id)));
    if (Date.now() < thread.backgroundSkipUntil) {
      for (const id of fresh) if (id) thread.shownIds.add(id);
      return;
    }
    const open = thread.activeTurn?.unprompted ? thread.activeTurn : null;
    const growing = open?.textMessageId ?? null;
    const grown = growing ? replayedText(updates, growing) : "";
    const shown = open ? open.text.slice(open.textMessageStart) : "";
    const added = open && grown.startsWith(shown) ? grown.slice(shown.length) : "";
    if (fresh.size === 0 && !open?.toolItems.size && !added) return;
    const turn = open ?? this.#beginTurn(thread, randomUUID(), { unprompted: true, answerOptional: true });
    if (growing && added)
      this.#applyTurnUpdate(thread, turn, {
        sessionUpdate: "agent_message_chunk",
        messageId: growing,
        content: { type: "text", text: added },
      });
    for (const [index, update] of updates.entries()) {
      const id = ids[index];
      if (id && (fresh.has(id) || turn.toolItems.has(id))) this.#applyTurnUpdate(thread, turn, update);
    }
    turn.lastActivityAt = Date.now();
  }

  #waitForUser<A, E>(turn: AcpTurn | null | undefined, request: Effect.Effect<A, E>): Effect.Effect<A, E> {
    if (!turn) return request;
    return Effect.suspend(() => {
      turn.answered = true;
      turn.waitingOnUser += 1;
      return request;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          turn.waitingOnUser -= 1;
          turn.lastActivityAt = Date.now();
        }),
      ),
    );
  }

  #foldSubagentTool(thread: AcpThread, turn: AcpTurn, toolCallId: string, content: unknown, item: ThreadItem): void {
    const call = {
      id: toolCallId,
      name: isString(item.name) ? item.name : "",
      status: isString(item.status) ? item.status : undefined,
      rawInput: item.arguments,
      rawOutput: item.result,
      content,
    };
    const subagentTools = this.#flavor.subagentTools;
    if (subagentTools) {
      this.#subagentThreads.set(turn.id, thread.id);
      this.#emitSubagents(foldAcpSubagentTool(this.#subagents, turn.id, subagentTools, call, new Date().toISOString()));
    }
    if (this.#flavor.childSessionUpdates) {
      noteOpenCodeLaunch(this.#openCodeLaunches, call);
      if (call.status === "completed") this.#emitSubagents(markOpenCodeBackground(this.#subagents, call.rawOutput));
    }
  }

  #extNotification(method: string, params: DynamicRecord): void {
    const retry = this.#flavor.retryNotice?.(method, params);
    if (retry) {
      const thread = this.#threads.get(retry.sessionId);
      const turn = thread?.activeTurn;
      if (!thread || !turn || turn.completing || turn.stopped) return;
      turn.lastActivityAt = Date.now();
      turn.retrying = "agent";
      this.#emitTurnProgress(
        thread,
        turn,
        sourceText(retry.unreachable ? "status.provider.retryUnreachable" : "status.provider.retryServerError", {
          provider: this.#providerName(thread),
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
        }),
      );
      return;
    }
    const failure = this.#flavor.mcpServerFailure?.(method.replace(/^_/, ""), params);
    if (failure) {
      if (this.#closedRecently(failure.sessionId) || isMcpSessionClosingDiagnostic(failure.reason)) {
        logger.warn("An ACP agent did not start an MCP server of a closing session.", {
          provider: this.provider,
          server: failure.name,
          reason: this.#redact(failure.reason),
        });
        return;
      }
      const thread = this.#threads.get(failure.sessionId);
      if (thread) {
        this.#reportMcpServerFailure(thread, failure);
        return;
      }
      const now = Date.now();
      this.#unclaimedMcpFailures = [
        ...this.#unclaimedMcpFailures.filter((entry) => now - entry.at < UNCLAIMED_MCP_FAILURE_MS),
        { ...failure, at: now },
      ].slice(-UNCLAIMED_MCP_FAILURE_LIMIT);
      return;
    }
    if (method.replace(/^_/, "") !== OPENCODE_CHILD_UPDATE_METHOD || !this.#flavor.childSessionUpdates) return;
    const thread = isString(params.rootSessionId) ? this.#threads.get(params.rootSessionId) : undefined;
    const turn = thread?.activeTurn ?? null;
    if (thread && turn) {
      turn.lastActivityAt = Date.now();
      this.#subagentThreads.set(turn.id, thread.id);
    }
    if (thread && thread.backgroundUntil > 0)
      thread.backgroundUntil = Math.max(thread.backgroundUntil, Date.now() + ACP_BACKGROUND_WATCH_MS);
    this.#emitSubagents(
      foldOpenCodeChildUpdate(
        this.#subagents,
        this.#openCodeLaunches,
        turn?.id ?? null,
        params,
        new Date().toISOString(),
      ),
    );
  }

  #emitSubagents(change: SubagentChange | null): void {
    if (!change) return;
    const threadId = this.#subagentThreads.get(change.turnId);
    if (!this.#subagents.turns.has(change.turnId)) this.#subagentThreads.delete(change.turnId);
    if (!threadId) return;
    this.emit("notification", {
      method: SUBAGENTS_UPDATED_METHOD,
      params: { threadId, turnId: change.turnId, subagents: change.subagents },
    });
  }

  #stopSubagents(): void {
    for (const change of stopSubagents(this.#subagents, new Date().toISOString())) this.#emitSubagents(change);
    this.#openCodeLaunches.clear();
  }

  #stopThreadSubagents(threadId: string): void {
    const turnIds = new Set<string>();
    for (const [turnId, owner] of this.#subagentThreads) if (owner === threadId) turnIds.add(turnId);
    if (turnIds.size === 0) return;
    for (const change of stopSubagents(this.#subagents, new Date().toISOString(), turnIds)) this.#emitSubagents(change);
    for (const turnId of turnIds) if (!this.#subagents.turns.has(turnId)) this.#subagentThreads.delete(turnId);
  }

  readonly #completeTurn = Effect.fn("AcpAgentClient.completeTurn")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    status: string,
    error: unknown,
  ) {
    if (thread.activeTurn !== turn || turn.completing) return;
    const beforeEcho = turn.beforeWakeEcho ?? [];
    turn.beforeWakeEcho = null;
    for (const update of beforeEcho) this.#applyTurnUpdate(thread, turn, update);
    turn.completing = true;
    if (this.#flavor.childSessionUpdates) yield* Effect.promise(() => new Promise<void>((next) => setImmediate(next)));
    if (status === "failed") {
      thread.instructionsSent = null;
      this.#turnContext.resend(thread.id);
    }
    if (status !== "completed") thread.backgroundSkipUntil = Date.now() + ACP_STOPPED_OUTPUT_MS;
    if (status === "failed" && (turn.sessionLost || isSessionNotFound(error, thread.id, this.#flavor))) {
      this.#forgetMissingSession(thread.id);
    }
    this.#completeThought(thread, turn);
    const workRuns =
      this.#flavor.wakesAfterPromptEnds === true &&
      status === "completed" &&
      !turn.stopped &&
      [...turn.toolItems.values()].some((item) => item.status === "in_progress");
    for (const item of turn.toolItems.values()) {
      const interrupted = (this.#flavor.interruptToolsOnStop === true || turn.abandoned) && status !== "completed";
      const settled = interrupted ? { ...item, status: status === "failed" ? "failed" : "interrupted" } : item;
      turn.messages.push(settled);
      if (interrupted)
        this.emit("notification", {
          method: "item/completed",
          params: { threadId: thread.id, turnId: turn.id, item: settled },
        });
    }
    turn.toolItems.clear();
    const selfWakes =
      this.#flavor.wakesAfterPromptEnds === true && this.#steersByPrompt && status === "completed" && !turn.stopped
        ? this.#selfWakesStarted(turn)
        : 0;
    this.#emitSubagents(endSubagentTurn(this.#subagents, turn.id, new Date().toISOString()));
    if (!this.#subagents.turns.has(turn.id)) this.#subagentThreads.delete(turn.id);
    this.#dropStreamedCopy(turn);
    const answer = turn.text;
    const failureReport = status === "failed" && this.#flavor.failureReport?.test(answer) === true;
    this.#completeMessage(thread, turn, "final_answer", failureReport);
    if (status === "failed" && error) {
      const detail = this.#redact(failureText(error));
      const message =
        this.options.savedKeyLimitMessage?.(detail, error) ??
        this.#flavor.turnFailure?.(
          error,
          detail,
          (text) => this.#redact(text),
          (text) => this.emit("diagnostic", this.#redact(text)),
          thread.currentModelId,
          this.options.customEndpoint?.(thread.currentModelId) ?? null,
          this.options.savedKey?.(thread.currentModelId) ?? false,
          (provider) => this.options.providerKeyStored?.(provider) ?? false,
          this.#label,
          () => this.options.providerRefusalStatus?.(thread.id) ?? null,
        ) ??
        detail;
      const causeCode = turn.failureCause ?? acpFailureCause(error, this.#flavor, message, answer);
      this.emit("notification", {
        method: "error",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          message,
          causeCode,
          ...(turn.accountLink ? { link: turn.accountLink } : {}),
        },
      });
    }
    const append = this.options.history?.append;
    if (append) {
      const persisted = yield* Effect.exit(
        append(thread.id, {
          turnId: turn.id,
          status,
          startedAt: turn.startedAt,
          items: turn.messages,
          complete: true,
        }),
      );
      if (Exit.isFailure(persisted)) {
        this.emit("diagnostic", this.#redact(`ACP history persistence failed: ${String(persisted.cause)}`));
        this.emit("notification", {
          method: "turn/completed",
          params: { threadId: thread.id, turn: { id: turn.id, status: "failed" } },
        });
        thread.activeTurn = null;
        if (this.#threads.get(thread.id) === thread) yield* this.#threads.markIdle(thread);
        return;
      }
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread.id, turn: { id: turn.id, status } },
    });
    thread.activeTurn = null;
    if (this.#threads.get(thread.id) !== thread) return;
    const earlier = this.#selfWakes.get(thread);
    const kept = earlier && Date.now() < earlier.until ? earlier : null;
    const left = status === "completed" && !turn.stopped ? (kept?.left ?? 0) + selfWakes : 0;
    if (left > 0) {
      const until = selfWakes > 0 ? Date.now() + ACP_BACKGROUND_WATCH_MS : (kept?.until ?? 0);
      const wake = { left, until };
      this.#selfWakes.set(thread, wake);
      Effect.runFork(this.#watchSelfWake(thread, wake).pipe(Effect.forkIn(this.#scope)));
    } else this.#selfWakes.delete(thread);
    if (workRuns || selfWakes > 0) this.#holdForWork(thread);
    yield* this.#threads.markIdle(thread);
  }, Effect.uninterruptible);

  #holdForWork(thread: AcpThread): void {
    const watching = thread.workHold !== null;
    const now = Date.now();
    thread.workHold = { since: now, changedAt: now };
    if (!watching) Effect.runFork(this.#watchHeldWork(thread).pipe(Effect.forkIn(this.#scope)));
  }

  readonly #watchHeldWork = Effect.fn("AcpAgentClient.watchHeldWork")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ) {
    let before: string | null | undefined;
    for (;;) {
      yield* Effect.sleep(ACP_WORK_HOLD_POLL_MS);
      const hold = thread.workHold;
      if (hold === null || this.#threads.get(thread.id) !== thread) return;
      if (thread.activeTurn) before = undefined;
      else {
        const read = yield* Effect.result(this.#sessionUpdatedAt(thread));
        if (Result.isSuccess(read)) {
          if (before !== undefined && read.success !== before) hold.changedAt = Date.now();
          before = read.success;
        }
      }
      const now = Date.now();
      if (now - hold.changedAt < ACP_BACKGROUND_WATCH_MS && now - hold.since < ACP_WORK_HOLD_MAX_MS) continue;
      thread.workHold = null;
      if (!thread.activeTurn) yield* this.#threads.markIdle(thread);
      return;
    }
  });

  #selfWakesStarted(turn: AcpTurn): number {
    const tools = this.#flavor.selfWakeTools;
    if (!tools) return 0;
    let count = 0;
    for (const item of turn.messages) {
      if (item.type !== "toolCall" || item.toolKind !== "other" || item.status === "failed") continue;
      if (!isString(item.name) || !tools.test(item.name)) continue;
      const list = isRecord(item.arguments) ? item.arguments.Subagents : undefined;
      count += Array.isArray(list) && list.length > 0 ? list.length : 1;
    }
    return count;
  }

  readonly #watchSelfWake = Effect.fn("AcpAgentClient.watchSelfWake")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    wake: { left: number; until: number },
  ) {
    let before: string | undefined;
    while (Date.now() < wake.until) {
      yield* Effect.sleep(ACP_BACKGROUND_POLL_MS);
      if (this.#selfWakes.get(thread) !== wake) return;
      if (thread.activeTurn || this.#openingTurns.has(thread.id)) return;
      if (this.#threads.get(thread.id) !== thread || thread.needsResume) break;
      const read = yield* Effect.result(this.#sessionUpdatedAt(thread));
      if (Result.isFailure(read)) continue;
      if (read.success === null) break;
      if (before === undefined || read.success === before) {
        before = read.success;
        continue;
      }
      if (this.#selfWakes.get(thread) !== wake || thread.activeTurn || this.#openingTurns.has(thread.id)) return;
      if (this.#threads.get(thread.id) !== thread || thread.needsResume) break;
      wake.left -= 1;
      const turn = this.#beginTurn(thread, randomUUID(), { unprompted: false, answerOptional: true, wake: true });
      turn.task = yield* Effect.forkIn(
        this.#consumePrompt(thread, turn, [{ type: "text", text: SELF_WAKE_NOTE }], {}),
        this.#scope,
        { startImmediately: true },
      );
      yield* Effect.forkIn(this.#watchStall(thread, turn), this.#scope);
      return;
    }
    if (this.#selfWakes.get(thread) === wake) this.#selfWakes.delete(thread);
  });

  #isApprovedEditSweep(turn: AcpTurn, update: AcpToolCallUpdate, toolKind: string): boolean {
    const sweep = this.#flavor.approvedEditSweep;
    if (!sweep) return false;
    const id = update.toolCallId;
    if (
      update.sessionUpdate === "tool_call" &&
      toolKind === "edit" &&
      update.status !== "pending" &&
      !turn.approvedEditRuns.has(id) &&
      !turn.approvedEdits.some((edit) => edit.id === id)
    ) {
      const approved = claimApprovedEdit(turn.approvedEdits, toolCallPaths(update));
      if (approved) turn.approvedEditRuns.set(id, approved);
    }
    if (update.status === "completed") {
      const approved = turn.approvedEditRuns.get(id);
      if (approved) turn.approvedEditsRan.add(approved);
      turn.approvedEdits = turn.approvedEdits.filter((edit) => edit.id !== id);
    }
    return update.status === "failed" && turn.approvedEditsRan.has(id) && sweep.test(toolOutputText(update.rawOutput));
  }

  readonly #requestPermission = Effect.fn("AcpAgentClient.requestPermission")(function* (
    this: AcpAgentClient,
    params: RequestPermissionRequest,
  ): Effect.fn.Return<RequestPermissionResponse, ProviderClientOperationError> {
    if (this.options.profileGeneration) {
      const allow = params.options.find((candidate) => candidate.kind === "allow_once");
      if (this.options.mediaGeneration && allow && this.#flavor.mediaTools?.permitted(params.toolCall))
        return { outcome: { outcome: "selected", optionId: allow.optionId } };
      return { outcome: { outcome: "cancelled" } };
    }
    if (this.#historyReplays.has(params.sessionId)) return { outcome: { outcome: "cancelled" } };
    const thread = this.#threads.get(params.sessionId);
    if (thread?.needsResume && !thread.activeTurn) return { outcome: { outcome: "cancelled" } };
    const turn = thread?.activeTurn;
    const turnId = turn?.id ?? randomUUID();
    const kind =
      params.toolCall.kind === "execute"
        ? "command"
        : ["edit", "delete", "move"].includes(params.toolCall.kind ?? "")
          ? "file-change"
          : "permissions";
    if (
      kind === "permissions" &&
      thread &&
      turn &&
      !turn.stopped &&
      !turn.completing &&
      ((this.options.confine && callsBridgeTool(thread, params.toolCall.title)) ||
        (turn.quietNoUpdate && callsNoUpdateTool(thread, params.toolCall.title)))
    ) {
      const option = params.options.find((candidate) => candidate.kind === "allow_once");
      if (option) return { outcome: { outcome: "selected", optionId: option.optionId } };
    }
    const requestedPermissions = kind === "permissions" ? { [params.toolCall.kind ?? "file-system"]: true } : null;
    const filePaths = kind === "file-change" ? permissionFilePaths(params.toolCall, thread?.cwd) : [];
    const result = yield* this.#waitForUser(
      turn,
      this.#serverRequests.call(
        `item/${kind === "command" ? "commandExecution" : kind === "file-change" ? "fileChange" : "permissions"}/requestApproval`,
        {
          threadId: params.sessionId,
          turnId,
          command: params.toolCall.kind === "execute" ? printableInput(params.toolCall.rawInput) : null,
          reason: params.toolCall.title ?? null,
          permissions: requestedPermissions,
          grantRoot: filePaths.length === 1 ? filePaths[0] : null,
          ...(this.options.confine && params.toolCall.kind !== "move" ? { confinedWritePaths: filePaths } : {}),
        },
        turn?.stop.signal,
      ),
    ).pipe(
      toProviderClientOperationError,
      Effect.catchIf(
        () => turn?.stopped === true,
        () => Effect.succeed(null),
      ),
    );
    if (turn?.stopped || turn?.completing) return { outcome: { outcome: "cancelled" } };
    const accepted =
      isRecord(result) &&
      (result.decision === "accept" ||
        result.decision === "approved" ||
        (isRecord(result.permissions) && Object.keys(result.permissions).length > 0));
    const option = bestPermissionOption(params.options, accepted);
    const { toolCallId } = params.toolCall;
    const approvedKind = params.toolCall.kind ?? turn?.toolKinds.get(toolCallId);
    if (turn && accepted && option && approvedKind === "edit" && this.#flavor.approvedEditSweep) {
      turn.approvedEdits.push({
        id: toolCallId,
        paths: toolCallPaths(params.toolCall, turn.toolItems.get(toolCallId)?.arguments),
      });
    }
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  });

  readonly #requestUserInput = Effect.fn("AcpAgentClient.requestUserInput")(function* (
    this: AcpAgentClient,
    method: string,
    params: DynamicRecord,
  ): Effect.fn.Return<DynamicRecord, ProviderClientOperationError> {
    const sessionId = getString(params, "sessionId") ?? [...this.#threads.ids()][0];
    const own = this.#flavor.userQuestions;
    const isOwn = own?.method === method.replace(/^_/u, "");
    if (sessionId && this.#historyReplays.has(sessionId)) return own && isOwn ? own.reply([], {}) : {};
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    const asked = isOwn
      ? getArray(params, "questions")
          .filter(isRecord)
          .map((question, index) => ({
            ...question,
            id: `question-${index}`,
            question: getString(question, "question") ?? "",
          }))
      : null;
    const toolCallId = isOwn ? getString(params, "toolCallId") : null;
    const questionCall = sessionId && toolCallId ? questionToolCallKey(sessionId, toolCallId) : null;
    const stoppedWaiting = new AbortController();
    if (questionCall) this.#openQuestionToolCalls.set(questionCall, stoppedWaiting);
    const result = yield* this.#waitForUser(
      thread?.activeTurn,
      this.#serverRequests.call(
        "item/tool/requestUserInput",
        {
          ...params,
          ...(asked ? { questions: asked } : {}),
          threadId: sessionId,
          turnId: thread?.activeTurn?.id ?? randomUUID(),
          sourceMethod: method,
        },
        stoppedWaiting.signal,
      ),
    ).pipe(
      toProviderClientOperationError,
      Effect.catchIf(
        () => stoppedWaiting.signal.aborted,
        () => Effect.succeed({}),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (questionCall && this.#openQuestionToolCalls.get(questionCall) === stoppedWaiting)
            this.#openQuestionToolCalls.delete(questionCall);
        }),
      ),
    );
    return yield* providerSync(() => {
      if (!(own && asked)) return isRecord(result) ? result : {};
      const answers = getRecord(result, "answers") ?? {};
      return own.reply(
        asked,
        Object.fromEntries(asked.map(({ id }) => [id, getArray(answers[id], "answers").filter(isString)])),
      );
    });
  });

  readonly #createElicitation = Effect.fn("AcpAgentClient.createElicitation")(function* (
    this: AcpAgentClient,
    params: CreateElicitationRequest,
  ): Effect.fn.Return<CreateElicitationResponse, ProviderClientOperationError> {
    const properties = getRecord(getRecord(params, "requestedSchema"), "properties") ?? {};
    const fields = elicitationFieldQuestions(params, "ACP");
    const choices = new Set(fields.filter(({ options }) => options?.length).map(({ id }) => id));
    const required = new Set(getArray(getRecord(params, "requestedSchema"), "required").filter(isString));
    const questions = fields.filter(
      ({ id }) => required.has(id) || !(id.endsWith("_custom") && choices.has(id.slice(0, -"_custom".length))),
    );
    if (questions.length === 0) {
      questions.push({
        id: "response",
        header: "ACP",
        question: getString(params, "message") ?? "ACP needs confirmation.",
        isSecret: false,
        options: null,
      });
    }
    const result = yield* this.#requestUserInput("session/elicitation", { ...params, questions });
    const answers = isRecord(result.answers) ? result.answers : null;
    if (!answers) return { action: "decline" };
    const content: Record<string, ElicitationContentValue> = {};
    for (const [id, answerValue] of Object.entries(answers)) {
      const answer = isRecord(answerValue) ? getArray(answerValue, "answers").filter(isString) : [];
      if (answer.length === 0) continue;
      content[id] = elicitationValue(isRecord(properties[id]) ? properties[id] : undefined, answer);
    }
    return yield* providerCall(() =>
      Object.keys(content).length > 0 ? { action: "accept", content } : { action: "decline" },
    );
  });

  readonly #callDynamicTool = Effect.fn("AcpAgentClient.callDynamicTool")(function* (
    this: AcpAgentClient,
    params: {
      threadId: string;
      turnId: string;
      callId: string;
      namespace: string;
      tool: string;
      arguments: unknown;
    },
    signal: AbortSignal,
    detachAfterMs: number | undefined,
    subagent: boolean,
  ): Effect.fn.Return<DynamicToolResult, ProviderClientOperationError> {
    if (this.#historyReplays.has(params.threadId)) {
      return { success: false, contentItems: [{ type: "inputText", text: "History replay cannot execute tools." }] };
    }
    const turn = this.#threads.get(params.threadId)?.activeTurn;
    if (turn) turn.answered = true;
    const deadlines =
      turn?.id === params.turnId
        ? [
            this.#flavor.mcpToolCallLimitMs === undefined
              ? undefined
              : this.#flavor.mcpToolCallLimitMs - MCP_TOOL_CALL_ANSWER_MARGIN_MS,
            detachAfterMs,
          ].filter((ms) => ms !== undefined)
        : [];
    const result = yield* this.#serverRequests
      .call(
        "item/tool/call",
        params,
        signal,
        detachAfterMs,
        deadlines.length > 0 ? Math.min(...deadlines) : undefined,
        subagent,
      )
      .pipe(toProviderClientOperationError);
    if (!isDynamicToolResult(result))
      return yield* providerFailure(new Error("OpenBot returned an invalid dynamic tool result."));
    if (turn?.id === params.turnId && params.tool === ROUTINE_NO_UPDATE_TOOL) turn.quietNoUpdate = endsQuiet(result);
    return yield* providerSync(() => result);
  });

  #requireThread(id: string): AcpThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown ACP session: ${id}`);
    return thread;
  }

  #requireConnection(): ClientSideConnection {
    return this.#transport.requireConnection();
  }
}

export function isDynamicToolNamespace(value: unknown): value is DynamicToolNamespace {
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

const promptBlocksEffect = Effect.fn("AcpAgentClient.promptBlocks")(function* (params: unknown, acceptsAudio: boolean) {
  const blocks: ContentBlock[] = [];
  let audioBase64Bytes = 0;
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) blocks.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path)) {
      const path = item.path;
      blocks.push({ type: "text", text: `Attached local file: ${path}` });
      const mimeType = attachmentMimeTypeForName(path);
      if (!acceptsAudio || !mimeType.startsWith("audio/")) continue;
      const { size } = yield* providerCall(() => stat(path));
      if (audioBase64Bytes + Math.ceil(size / 3) * 4 > ACP_PROMPT_AUDIO_BASE64_BYTES) continue;
      const data = (yield* providerCall(() => readFile(path))).toString("base64");
      audioBase64Bytes += data.length;
      blocks.push({ type: "audio", data, mimeType });
    }
    if (item.type === "localImage" && isString(item.path)) {
      const path = item.path;
      const data = yield* providerCall(() => readFile(path));
      blocks.push({
        type: "image",
        data: data.toString("base64"),
        mimeType: attachmentMimeTypeForName(path),
        uri: item.path,
      });
    }
  }
  return blocks;
});

function permissionFilePaths(toolCall: RequestPermissionRequest["toolCall"], cwd: string | undefined): string[] {
  const paths = [
    ...(toolCall.locations ?? []).map((location) => location.path),
    ...(toolCall.content ?? []).flatMap((item) => (item.type === "diff" ? [item.path] : [])),
  ];
  return [...new Set(paths.map((path) => (cwd ? resolve(cwd, path) : path)))];
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

type AcpToolCallUpdate = Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>;

function questionToolCallKey(sessionId: string, toolCallId: string): string {
  return JSON.stringify([sessionId, toolCallId]);
}

function toolCallPaths(
  call: { readonly locations?: readonly { readonly path: string }[] | null; readonly rawInput?: unknown },
  earlierInput?: unknown,
): string[] {
  const paths = (call.locations ?? []).map((location) => location.path);
  for (const input of [call.rawInput, earlierInput]) {
    if (!isRecord(input)) continue;
    for (const key of ["TargetFile", "file_path", "path"]) {
      const value = input[key];
      if (isString(value)) paths.push(value);
    }
  }
  return [...new Set(paths.map((path) => path.replace(/\\/g, "/").toLowerCase()))];
}

function claimApprovedEdit(
  approvedEdits: { id: string; paths: readonly string[] }[],
  paths: readonly string[],
): string | undefined {
  let index = approvedEdits.findIndex((edit) => edit.paths.some((path) => paths.includes(path)));
  if (index < 0 && approvedEdits.length === 1 && (paths.length === 0 || approvedEdits[0]?.paths.length === 0)) {
    index = 0;
  }
  return index < 0 ? undefined : approvedEdits.splice(index, 1)[0]?.id;
}

function toolOutputText(rawOutput: unknown): string {
  if (isString(rawOutput)) return rawOutput;
  return isRecord(rawOutput) && isString(rawOutput.output) ? rawOutput.output : "";
}

function bestPermissionOption(options: PermissionOption[], accepted: boolean): PermissionOption | null {
  const kinds = accepted ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  return kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0] ?? null;
}

function callsBridgeTool(thread: AcpThread, title: string | null | undefined): boolean {
  return thread.dynamicTools.some((namespace) =>
    namespace.tools.some((tool) => title === `${namespace.name}__${tool.name}`),
  );
}

function callsNoUpdateTool(thread: AcpThread, title: string | null | undefined): boolean {
  return thread.dynamicTools.some(
    (namespace) =>
      namespace.tools.some((tool) => tool.name === ROUTINE_NO_UPDATE_TOOL) &&
      (title === `${namespace.name}__${ROUTINE_NO_UPDATE_TOOL}` ||
        title === `Run mcp_${namespace.name}_${ROUTINE_NO_UPDATE_TOOL}`),
  );
}

function endsQuiet(result: DynamicToolResult): boolean {
  const [first] = result.contentItems;
  if (first?.type !== "inputText") return false;
  try {
    const value = JSON.parse(first.text);
    return isRecord(value) && value.status === "quiet";
  } catch {
    return false;
  }
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

class MissingAcpSessionError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MissingAcpSessionError";
  }
}

function contentMessageId(update: SessionNotification["update"]): string | null {
  if (!("messageId" in update) || typeof update.messageId !== "string" || update.messageId.length === 0) return null;
  return update.messageId;
}

function shownEntryId(update: SessionUpdate): string | null {
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") return update.toolCallId;
  if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk")
    return update.content.type === "text" && update.content.text ? contentMessageId(update) : null;
  return null;
}

function replayedText(updates: readonly SessionUpdate[], messageId: string): string {
  return updates
    .map((update) =>
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text" &&
      contentMessageId(update) === messageId
        ? update.content.text
        : "",
    )
    .join("");
}

function startsBackgroundTask(rawOutput: unknown): boolean {
  const metadata = getRecord(rawOutput, "metadata");
  return metadata?.status === "running" && (isString(metadata.sessionID) || isString(metadata.shellID));
}

function isSessionNotFound(error: unknown, sessionId: string, flavor: AcpFlavor): boolean {
  if (!(error instanceof RequestError)) return false;
  const flavored = flavor.sessionNotFound?.(error, sessionId) ?? null;
  if (flavored !== null) return flavored;
  if (error.code !== -32002) return false;
  const data = isRecord(error.data) ? error.data : undefined;
  return data?.sessionId === sessionId || data?.uri === sessionId || error.message.includes(sessionId);
}

function failureDetail(error: RequestError): string | null {
  const data = error.data;
  const detail =
    typeof data === "string"
      ? data
      : isRecord(data)
        ? (data.details ?? data.detail ?? data.message ?? data.error)
        : undefined;
  return typeof detail === "string" && detail ? detail : null;
}

function acpFailureCause(error: unknown, flavor: AcpFlavor, sentence: string, answer: string): CauseCode {
  if (error instanceof RequestError) return acpRequestCause(error, flavor, sentence, answer);
  const flavored = flavor.failureCause?.(error, answer) ?? null;
  if (flavored) return flavored;
  if (error === "max_tokens" || error === "max_turn_requests") return "turn_limit";
  if (error === "refusal") return "content_blocked";
  const cause = textCause(classifyFailure(error), sentence);
  return cause === "unknown" && error instanceof AgentProcessExitError ? "provider_exited" : cause;
}

function acpRequestCause(error: RequestError, flavor: AcpFlavor, sentence: string, answer: string): CauseCode {
  if (error.code === -32000) return "authentication";
  const status = dataHttpStatus(error.data);
  const structured = flavor.failureCause?.(error, answer) ?? (status === null ? null : httpStatusCause(status));
  const cause = structuredCause(structured, textCause(classifyFailure(failureText(error)), sentence));
  if (cause !== "unknown") return cause;
  if (error.code === -32600 || error.code === -32601 || error.code === -32602) return "invalid_request";
  if (error.code === -32002) return "not_found";
  return error.code === -32603 ? "provider_internal_error" : "unknown";
}

function textCause(raw: CauseCode, sentence: string): CauseCode {
  return raw === "unknown" ? classifyFailure(sentence) : raw;
}

function dataHttpStatus(data: unknown): number | null {
  if (!isRecord(data)) return null;
  for (const key of ["http_status", "httpStatus", "statusCode", "status"]) {
    const value = data[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d{1,3}$/u.test(value)) return Number(value);
  }
  return null;
}

function failureText(error: unknown): string {
  if (!(error instanceof RequestError)) return String(error);
  const detail = failureDetail(error);
  return detail && !error.message.includes(detail) ? `${String(error)}: ${detail}` : String(error);
}

const HARNESS_ERROR_CHUNK = /^\s*API Error: [^\n]*The response above may be incomplete\.\s*$/u;

function isAuthenticationError(error: unknown): boolean {
  if (error instanceof RequestError && error.code === -32000) return true;
  const text = failureText(error);
  return classifyUserError(text) === "auth" || /\bAPI key not valid\b|\bAPI_KEY_INVALID\b/u.test(text);
}
