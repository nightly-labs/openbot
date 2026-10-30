import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import {
  type ClientSideConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
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
import type { AgentSessionSettingsSnapshot, AgentSessionSettingValue } from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Scope, Semaphore } from "effect";
import {
  AcpConfiguration,
  type AcpModel,
  currentModelFromSessionSetup,
  sessionSettingsSnapshot,
} from "./acp-configuration";
import { AcpConnection, type AcpConnectionOptions } from "./acp-connection";
import type { AcpFlavor } from "./acp-flavor";
import { acpPlanSteps, PLAN_UPDATED_METHOD } from "./agent/plan-updates";
import { elicitationOptions, elicitationValue, secretElicitationField } from "./agent/prompts";
import { type AgentProvider, type DiagnosticOrigin, ProviderTurnActiveError } from "./agent-client";
import type { AgentCliInfo } from "./cli";
import { runCauseEffect } from "./effect-boundary";
import { IdleThreadPool } from "./idle-thread-pool";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  acpMcpServers,
  agentMcpServers,
  computerUseParam,
  type McpDropReporter,
  type McpEndpointSource,
  type McpServerSource,
  type McpToolRuntimeSource,
  mcpAgentParam,
  providerMcpServerName,
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

/** How long the second `session/load` waits after a failure that lists the sessions (OpenCode). */
const RESTORE_LIST_RETRY_MS = 500;

/** How long the second `session/resume` waits while the new process still starts (OpenCode). */
const RESTORE_START_RETRY_MS = 2_000;

/** How many `session/list` pages OpenBot reads to find a session before it stops looking. */
const SESSION_LIST_PAGES = 50;

/** Maximum replay work waiting for the storage consumer before the import fails safely. */
const ACP_HISTORY_REPLAY_QUEUE_LIMIT = 256;

/**
 * How long a turn may send nothing, with no tool call open and no question to the user, before
 * OpenBot ends it. An OpenCode prompt can stay open for an hour with no update (#2858).
 */
const ACP_TURN_STALL_MS = 5 * 60_000;

/** How long a stopped turn may take to end before OpenBot ends it itself. */
const ACP_STOP_GRACE_MS = 10_000;

/** How often OpenBot asks `session/list` whether a session with a background task has changed. */
const ACP_BACKGROUND_POLL_MS = 2_000;

/** How long OpenBot watches a session after a background task starts or the session last changes. */
const ACP_BACKGROUND_WATCH_MS = 30 * 60_000;

/**
 * How long a turn that the agent started for a finished background task may stay unchanged, with
 * no tool call open, before OpenBot ends it. The agent's store changes when that turn ends, but it
 * can also stay unchanged while the model writes a long step.
 */
const ACP_BACKGROUND_TURN_QUIET_MS = 15_000;

/**
 * How long the agent's store can still get the rest of a turn that did not complete, such as one
 * that OpenCode went on with after a stop (#2858). A background replay does not show that rest.
 */
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
  /** The model sent reasoning text. An empty OpenCode turn then names reasoning without an answer. */
  reasoned: boolean;
  /**
   * The partial reply and the harness error that cut it. It becomes the answer when no text comes
   * after the error, because then the harness did not retry.
   */
  interruptedAnswer: string | null;
  /** A failure that the server sent as answer text and then ended the turn as a success. */
  providerError: string | null;
  /**
   * Where the answer text stood when Antigravity logged that its SDK failed this prompt. The
   * server then sends the failure as answer text and ends the turn as a success.
   */
  sdkFailureAt: number | null;
  /** The prompt told the model not to answer, so an empty turn is a success. */
  answerOptional: boolean;
  messages: ThreadItem[];
  toolNames: Map<string, string>;
  /** The ACP `kind` of each tool call; a later update can omit it. */
  toolKinds: Map<string, string>;
  /** The latest durable shape of each tool call until ACP reports its terminal status. */
  toolItems: Map<string, ThreadItem>;
  /** The user stopped the turn. */
  stopped: boolean;
  completing: boolean;
  task: Fiber.Fiber<void, ProviderClientOperationError> | null;
  /** When the agent last sent an update for this turn, or the user last answered it. */
  lastActivityAt: number;
  /** Questions and approvals that wait for the user. The turn is not stalled while one is open. */
  waitingOnUser: number;
  /** OpenBot ended the turn because the agent did not. Its open tool calls get no more updates. */
  abandoned: boolean;
  /** The session's total cost in USD at this turn's last `usage_update`, when the agent sends one. */
  reportedCost: number | null;
  /** The agent started this turn for a finished background task. OpenBot replays it from `session/load`. */
  unprompted: boolean;
  /** The ACP `messageId` of the last text in `text`, and where that message's text starts in it. */
  textMessageId: string | null;
  textMessageStart: number;
}

/** The parts of a `session/load` request that open this session as it was opened. */
type AcpSessionRestore = Omit<LoadSessionRequest, "sessionId">;

interface AcpThread {
  id: string;
  cwd: string;
  developerInstructions: string;
  /**
   * The instructions that the session already has in its context, or null when the next prompt must
   * carry them: a new or loaded session, a changed text, a compaction, or a failed prompt.
   */
  instructionsSent: string | null;
  /** Tokens in the session's context at the last `usage_update`; null while the agent sends none. */
  contextUsed: number | null;
  /** Prompts since the instructions were sent, for an agent that reports no context size. */
  promptsSinceInstructions: number;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  mcp: LocalMcpSession;
  activeTurn: AcpTurn | null;
  /** Antigravity cancel can leave its stream open. Reload this same session before new input. */
  needsResume: boolean;
  /** The session's own process (`AcpFlavor.sessionProcesses`), or null when it runs in the agent's. */
  transport: AcpConnection | null;
  dynamicTools: DynamicToolNamespace[];
  workspaceRoots: string[];
  /** Whether the session got the Computer Use server. Its MCP servers are fixed when it opens. */
  computerUse: boolean;
  /** The agent whose session this is, named to the MCP servers that OpenBot signed in to. */
  agentId: string | null;
  idleRelease: ReturnType<typeof setTimeout> | null;
  /** Also set when the session was loaded only for a read. */
  idleSince: number;
  /** The `session/load` request that a background replay sends, with the session's MCP servers. */
  restore: AcpSessionRestore;
  /** The ACP message and tool call IDs that this session already showed (`unsentBackgroundTurns`). */
  shownIds: Set<string>;
  /** Until when OpenBot watches the session for turns of a background task. 0: no watch. */
  backgroundUntil: number;
  /** The session's `updatedAt` in the last `session/list`. */
  backgroundUpdatedAt: string | null;
  /** Until when a replay marks new entries as shown and does not show them: the rest of a stopped turn. */
  backgroundSkipUntil: number;
  /** A background replay that runs. A prompt waits for it, so that its updates do not mix. */
  backgroundReplay: Deferred.Deferred<void> | null;
}

/** What a closed idle session needs to be loaded again. Completed history lives in storage. */
type ReleasedAcpThread = Pick<
  AcpThread,
  "cwd" | "developerInstructions" | "dynamicTools" | "workspaceRoots" | "computerUse" | "agentId"
>;

/** Persistence hooks for provider history. The database owns the data; ACP only streams it. */
export interface AcpHistoryPersistence {
  readonly read?: ReadProviderHistory;
  /** Reports whether the stored import covers the requested session. */
  readonly complete?: (request: ProviderHistoryRequest) => Effect.Effect<boolean, ProviderClientOperationError>;
  readonly append?: (
    threadId: string,
    fragment: ProviderHistoryFragment,
  ) => Effect.Effect<void, ProviderClientOperationError>;
}

/**
 * How long a session with no turn stays open in the agent process. The agent starts the user's MCP
 * servers for each session and keeps them until the session closes, and the agent loads the same
 * session again from its own store, so an idle session costs only a slower first message.
 */
const ACP_SESSION_IDLE_RELEASE_MS = 10 * 60_000;

/** An agent that reports no context size gets the instructions again after this many prompts. */
const ACP_INSTRUCTIONS_REFRESH_PROMPTS = 10;

/** A context that shrinks below this share of its last size has been compacted. */
const ACP_COMPACTION_CONTEXT_RATIO = 0.6;

/**
 * How many idle sessions stay open before the timeout. Grok gives each session its own set of the
 * user's MCP servers (`npx chrome-devtools-mcp` is about 300 MB), so one turn on each of five agents
 * otherwise holds five sets for ten minutes.
 */
const ACP_IDLE_SESSION_LIMIT = 2;

interface AcpProviderAccount {
  email: string | null;
  planType: string | null;
}

/** A load replay is consumed as it arrives and never enters the live turn path. */
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
  pending: number;
  error: unknown;
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
  /** Durable history supplied by the database. ACP never owns a full conversation snapshot. */
  history?: AcpHistoryPersistence | undefined;
  /** The name in error text. The provider name when absent; a custom agent gives its own. */
  label?: string;
  /**
   * What this agent does differently from the protocol (`acp-flavor.ts`). Each client names one, so
   * a new provider cannot get another provider's rules by default.
   */
  flavor: AcpFlavor;
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
  /** Models the agent runs but does not list, added after its own (`AcpModel.unlisted`). */
  additionalModels?: () => Effect.Effect<AcpModel[]>;
  /** The name to show for a listed model, from its id and the name that the agent sent. */
  modelName?: (id: string, name: string) => string;
  /** The name to show for the provider of a model, when it is not this agent's own (a custom endpoint). */
  providerName?: (modelId: string | null) => string | null;
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
  /** A temporary folder of its own for each process (`provider-temp.ts`). */
  privateTemp?: AcpConnectionOptions["privateTemp"];
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
  /** How long a turn may send nothing before it fails (`ACP_TURN_STALL_MS` when absent). */
  turnStallMs?: number;
  /** What this provider could not be given. Reported once per spawn, by `AgentService`. */
  reportMcpDrops?: McpDropReporter | undefined;
  mcpToolRuntimes?: McpToolRuntimeSource | undefined;
  mcpEndpoint?: McpEndpointSource | undefined;
  authenticate?(
    connection: ClientSideConnection,
    initialization: InitializeResponse,
  ): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * The message for a refused sign-in while a saved key is in use, or `null` without a key. A
   * refused key must say so: a browser sign-in cannot help while the key wins over it.
   */
  savedKeyRefusedMessage?: () => string | null;
  /**
   * The stderr line of a server that starts an interactive sign-in by itself when its token is not
   * valid. The account check then reports sign-in required at once and does not wait for the user.
   */
  interactiveSignInPrompt?: RegExp;
  /**
   * Reads optional identity fields that ACP does not define. A provider extension failing must not
   * turn a working authenticated process into a signed-out one, so account/read falls back to null
   * fields when this hook cannot answer.
   */
  readAccount?(
    connection: ClientSideConnection,
  ): Effect.Effect<Partial<AcpProviderAccount>, ProviderClientOperationError>;
  /**
   * Reads the account's plan usage. `privatePrompt` sends one prompt in a session that no thread
   * owns and returns the answer text, for an agent that reports usage through a slash command.
   * `model` is the model whose limit the caller checks, or null for the account's own reading.
   */
  readRateLimits?(
    connection: ClientSideConnection,
    privatePrompt: (text: string) => Effect.Effect<string, ProviderClientOperationError>,
    model: string | null,
  ): Effect.Effect<AccountRateLimitsReadResult, ProviderClientOperationError>;
  /**
   * Gives the running turn a message that the agent reads at its next step. ACP has no steer
   * request, so only an agent with an extension of its own has this; without it the message waits
   * in the queue.
   */
  steer?(
    connection: ClientSideConnection,
    message: { sessionId: string; messageId: string | null; blocks: ContentBlock[] },
  ): Effect.Effect<void, ProviderClientOperationError>;
}

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  get contextCompaction(): "handoff" | "unsupported" {
    return this.#flavor.contextCompaction ?? "unsupported";
  }
  get provider(): AgentProvider {
    return this.options.provider;
  }
  readonly #flavor: AcpFlavor;
  readonly #transport: AcpConnection;
  readonly #configuration: AcpConfiguration;
  readonly #requestTimeoutMs: number;
  readonly #cli: AgentCliInfo;
  /** Whether `#endIfUnresponsive` waits for its probe. */
  #probing = false;
  readonly #bridge = new LocalMcpBridge();
  readonly #threads = new IdleThreadPool<AcpThread, ReleasedAcpThread>({
    scope: () => this.#scope,
    releaseAfterMs: ACP_SESSION_IDLE_RELEASE_MS,
    idleLimit: ACP_IDLE_SESSION_LIMIT,
    // An agent that cannot close a session and load it again would keep its MCP servers or lose it.
    // A session with a process of its own closes when that process ends.
    // A watched session stays open: a closed one would not report the end of its background task.
    canRelease: (thread) =>
      this.#loadsSessions &&
      (thread.transport !== null || Boolean(this.#initialization?.agentCapabilities?.sessionCapabilities?.close)) &&
      thread.backgroundUntil === 0,
    snapshot: ({ cwd, developerInstructions, dynamicTools, workspaceRoots, computerUse, agentId }) => ({
      cwd,
      developerInstructions,
      dynamicTools,
      workspaceRoots,
      computerUse,
      agentId,
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
  /** Session loads currently being consumed as history. These updates must never become live turns. */
  readonly #historyReplays = new Map<string, HistoryReplay>();
  /** The updates of each background replay's `session/load`, by session. */
  readonly #backgroundReplays = new Map<string, SessionUpdate[]>();
  /** Prompts that are being prepared, by session. A background replay waits until none is. */
  readonly #openingTurns = new Map<string, number>();
  /**
   * The session of `#privatePrompt`, kept for the process: no thread or transcript sees it, and each
   * new Antigravity session leaves a conversation database of its own on disk, also after it closes.
   */
  #privateSession: { connection: ClientSideConnection; sessionId: string } | null = null;
  /** The answer text of the private prompt in progress. One prompt runs at a time. */
  #privateAnswer: string[] | null = null;
  readonly #privatePromptLock = Semaphore.makeUnsafe(1);
  readonly #serverRequests = new PendingServerRequests((request) => this.emit("request", request));
  #initialized: Deferred.Deferred<void, ProviderClientOperationError> | null = null;
  #scope = Scope.makeUnsafe();
  #initialization: InitializeResponse | null = null;
  /** How long the agent's own process had to start, which each session's process gets too. */
  #startTimeoutMs: number | null = null;
  #models: AcpModel[] = [];
  #lastTurnStartedAt = 0;
  #signedIn = false;
  /** Settles when the server asks for an interactive sign-in while `initialize` checks the account. */
  #signInPrompt: Deferred.Deferred<void> | null = null;

  constructor(
    cli: AgentCliInfo,
    requestTimeoutMs = 30_000,
    private readonly options: AcpProviderOptions,
  ) {
    super();
    this.#flavor = options.flavor;
    this.#cli = cli;
    this.#transport = this.#newTransport((error) => this.emit("exit", error));
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#configuration = new AcpConfiguration({
      connection: () => this.#requireConnection(),
      scope: () => this.#scope,
      label: () => this.#label,
      provider: options.provider,
      requestTimeoutMs,
      discoveryCwd: options.discoveryCwd,
      processWideModel: options.flavor.processWideModel === true,
      keepProbeSession: () => options.flavor.closeKeepsSession === true && this.#supportsSessionResume,
    });
  }

  /** A process of this agent. `exit` hears an end that `stop` did not start. */
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
      privateDiagnostic: this.options.interactiveSignInPrompt,
      diagnostic: (message, origin) => {
        // The prompt carries OAuth state, so it is not a diagnostic. Only an explicit sign-in opens it.
        if (this.options.interactiveSignInPrompt?.test(message)) {
          if (this.#signInPrompt) Deferred.doneUnsafe(this.#signInPrompt, Exit.void);
          else {
            // The token stopped being valid after the account check, and the server now waits five
            // minutes for a browser that does not open. The process ends, so its request fails now.
            this.#signedIn = false;
            this.emit("exit", new Error(this.options.signInMessage));
          }
          return;
        }
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
      }),
    });
  }

  /** Reads durable history first; load-only ACP agents are streamed into the same consumer. */
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
      // If the import is incomplete, do not publish its partial pages and then publish the whole
      // transcript after ACP load. Staging first keeps SQLite's newest-first order and avoids
      // duplicate live items.
      if (complete && (yield* complete(request))) {
        yield* readStored(request);
        return;
      }
    }
    // `session/resume` intentionally returns no history. A complete stored import is handled
    // above; without one, a session/load capable agent is the only replay source.
    if (!request.cwd) {
      if (stored && durableReplay) yield* readStored(request);
      return;
    }
    yield* this.#ensureInitializedEffect();
    if (this.#supportsSessionResume || !this.#loadsSessions) {
      if (stored && durableReplay) yield* readStored(request);
      return;
    }
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
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
      pending: 0,
      error: null,
    };
    this.#historyReplays.set(request.threadId, replay);
    try {
      try {
        // Share the per-session load gate with a concurrent resume. A boot history read and the
        // first turn can arrive in the same tick; both must use one ACP session.
        providerResult(
          yield* Effect.result(
            this.#startThread(
              {
                threadId: request.threadId,
                cwd: request.cwd,
                includeTurns: request.items === "full",
              },
              true,
            ),
          ),
        );
      } catch (error) {
        // A provider can delete an old session. Stored OpenBot history remains valid, so a read
        // reports the available fragments and leaves the caller to create a replacement session.
        if (error instanceof MissingAcpSessionError) {
          if (stored && durableReplay) yield* readStored(request);
          return;
        }
        return yield* providerFailure(error);
      }
      // An empty load is not evidence that the provider covered the saved session. In particular,
      // a legacy ACP agent can answer `session/load` before it has replayed an older transcript.
      // Leave the import active in that case; a later recovery can retry without declaring missing
      // turns complete. A real replay turn always has a boundary to finish here.
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
      const thread = this.#threads.get(request.threadId);
      if (thread && !thread.activeTurn) yield* this.#threads.markIdle(thread);
    }
  });

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
    return this.#transport.running;
  }

  start(): void {
    if (this.running) return;
    this.#scope = Scope.makeUnsafe();
    this.#transport.start();
  }

  readonly stop = Effect.fn("AcpAgentClient.stop")(function* (
    this: AcpAgentClient,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    yield* this.#transport
      .stop(
        Effect.gen({ self: this }, function* () {
          this.#initialized = null;
          for (const replay of this.#historyReplays.values()) this.#abortHistoryReplay(replay);
          this.#historyReplays.clear();
          const threads = this.#threads.clear();
          for (const thread of threads) thread.mcp.close();
          yield* Effect.forEach(
            threads,
            (thread) => (thread.transport ? thread.transport.stop(Effect.void).pipe(Effect.ignore) : Effect.void),
            { concurrency: "unbounded", discard: true },
          );
          this.#startingThreads.clear();
          this.#serverRequests.rejectAll("ACP session stopped.");
          yield* this.#bridge.close().pipe(toProviderClientOperationError);
        }),
      )
      .pipe(Effect.ensuring(Scope.close(this.#scope, Exit.void)));
  }, Effect.uninterruptible);

  readonly readSessionSettings = Effect.fn("AcpAgentClient.readSessionSettings")(function* (
    this: AcpAgentClient,
    threadId: string,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    const thread = yield* providerSync(() => this.#requireThread(threadId));
    return sessionSettingsSnapshot(thread.configOptions);
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
    // A session whose own process ended opens again on a new one before the setting is sent there.
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
      params: { threadId: thread.id, ...sessionSettingsSnapshot(thread.configOptions) },
    });
  }

  /**
   * The agent compacted the session by itself. The summary replaced the prompt that carried the
   * instructions, and the channel messages that the session read, so the next turn sends both again.
   */
  #compacted(thread: AcpThread): void {
    thread.instructionsSent = null;
    this.emit("notification", {
      method: "openbot/context-compaction",
      params: { threadId: thread.id, status: "completed" },
    });
  }

  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError> {
    return this.#threads.releaseIdle();
  }

  /** A non-resumable ACP session must keep its process and in-memory context. */
  canReleaseProcess(): boolean {
    if (this.#threads.ids().next().done) return true;
    return this.#supportsSessionResume || this.#loadsSessions;
  }

  /**
   * Closes one session and keeps the agent process for the other threads. The bridge session goes
   * first, because it is this app's own child; the agent is then told to drop the session, which is
   * what ends the MCP servers it started for it. An agent that does not answer `session/close` is
   * ignored: the session is already replaced on this side.
   */

  readonly releaseThread = Effect.fn("AcpAgentClient.releaseThread")(function* (
    this: AcpAgentClient,
    sessionId: string,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#threads.forget(sessionId);
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    yield* this.#threads.close(thread).pipe(toProviderClientOperationError);
  });

  /** The provider already removed this session. Do not wait for another remote cleanup request. */
  #forgetMissingSession(sessionId: string): void {
    this.#threads.forget(sessionId);
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    this.#threads.detach(thread);
    thread.mcp.close();
    if (thread.transport) Effect.runFork(thread.transport.stop(Effect.void).pipe(Effect.ignore));
  }

  readonly #closeSession = Effect.fn("AcpAgentClient.closeSession")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    thread.mcp.close();
    if (thread.transport) return yield* thread.transport.stop(Effect.void);
    yield* providerCall(() =>
      this.#transport.connection?.closeSession({ sessionId: thread.id }).catch(() => undefined),
    );
  });

  /**
   * The answer to a usage prompt that the user saved on a custom agent, such as `/usage`, read in the
   * private session, so no thread or transcript sees it. Null while the agent is not signed in or
   * gives no text. The values the agent was started with, and known secret shapes, are redacted.
   */
  readonly readUsageText = Effect.fn("AcpAgentClient.readUsageText")(function* (
    this: AcpAgentClient,
    _model: string,
    prompt: string,
  ): Effect.fn.Return<string | null, ProviderClientOperationError> {
    if (!this.running) return yield* providerFailure(new Error("ACP client is not running."));
    yield* this.#ensureInitializedEffect();
    if (!this.#signedIn) return null;
    // The time limit starts when the lock is held, so a prompt that waits for another one keeps its time.
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

  #privatePrompt(text: string): Effect.Effect<string, ProviderClientOperationError> {
    return this.#privatePromptLock.withPermit(this.#privatePromptOnce(text));
  }

  /**
   * A prompt that times out is cancelled and drops the session, because the agent may still be
   * answering it. An error answer keeps it: a new session would leave one more conversation database
   * on disk.
   */
  readonly #privatePromptOnce = Effect.fn("AcpAgentClient.privatePrompt")(function* (
    this: AcpAgentClient,
    text: string,
  ): Effect.fn.Return<string, ProviderClientOperationError> {
    const connection = yield* providerSync(() => this.#requireConnection());
    if (this.#privateSession?.connection !== connection) {
      const { sessionId } = yield* providerCall(() =>
        connection.newSession({ cwd: this.options.discoveryCwd?.() ?? process.cwd(), mcpServers: [] }),
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
          // `session/cancel` is a notification, so this does not wait for the agent.
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
    // A session with a process of its own fails with how that process ended.
    const transport = (sessionId ? this.#threads.get(sessionId)?.transport : null) ?? this.#transport;
    const ended = transport.ended;
    try {
      return providerResult(yield* Effect.result(this.#requestEffect(method, params, decoder, timeoutMs)));
    } catch (error) {
      if (error instanceof TimeoutError)
        yield* Effect.forkIn(
          this.#endIfUnresponsive(sessionId ? this.#threads.get(sessionId) : undefined),
          this.#scope,
        );
      if (
        sessionId &&
        (method === "turn/start" || method === "thread/resume") &&
        !this.#threads.get(sessionId)?.activeTurn &&
        isSessionNotFound(error, sessionId, this.#flavor)
      ) {
        // No prompt was sent. Drop the stale handle so the queue can load or replace the session.
        this.#forgetMissingSession(sessionId);
        return yield* providerFailure(new MissingAcpSessionError(`ACP session not found: ${sessionId}`, error));
      }
      if (
        error instanceof RequestError &&
        (method === "turn/start" ||
          method === "turn/steer" ||
          ((method === "thread/start" || method === "thread/resume") && failureDetail(error) !== null))
      ) {
        // Keep the protocol error type: details alone must never authorize session replacement.
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
            ? yield* readRateLimits(
                this.#requireConnection(),
                (text) => this.#privatePrompt(text),
                getString(params, "model"),
              ).pipe(
                Effect.timeoutOrElse({
                  duration: timeoutMs ?? this.#requestTimeoutMs,
                  orElse: () =>
                    Effect.fail(
                      providerFailure(new TimeoutError(`${this.#label} request timed out: account/rateLimits/read`)),
                    ),
                }),
              )
            : { rateLimits: null, rateLimitsByLimitId: null };
          return yield* providerSync(() => decoder(response));
        }
      case "model/list":
        yield* this.#ensureInitializedEffect();
        if (this.#signedIn) {
          try {
            this.#models = providerResult(yield* Effect.result(this.#discoverModels(timeoutMs)));
          } catch (error) {
            // A flavor can keep the last successful list. Other agents report the failure.
            if (!this.#flavor.keepModelsOnRefreshFailure || this.#models.length === 0)
              return yield* providerFailure(error);
          }
        }
        return yield* providerSync(() =>
          decoder({
            data: this.#models.map((model) => ({
              model: model.id,
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
      case "thread/start": {
        const response = yield* this.#startThread(params, false);
        return yield* providerSync(() => decoder(response));
      }
      case "thread/resume": {
        const response = yield* this.#startThread(params, true);
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
                // readHistory is newest-first; the released response is chronological.
                turns: [...turns.values()].reverse(),
              },
            }),
          );
        }
        // Keep the legacy endpoint's session warm for callers that use it as a metadata read. Full
        // history goes through `readHistory` and is retained only for this explicit response.
        yield* this.#readableThreadEffect(threadId, params);
        return yield* providerSync(() => decoder({ thread: { id: threadId, turns: [] } }));
      }
      case "turn/start": {
        const response = yield* this.#startTurnEffect(params);
        return yield* providerSync(() => decoder(response));
      }
      case "turn/steer": {
        // A second ACP prompt can cancel the active turn. Keep deferred input in the mailbox.
        const steer = this.options.steer;
        if (!steer) return yield* providerFailure(new Error(sourceText("error.backend.steerUnsupported")));
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        const thread = this.#threads.get(threadId);
        const turn = thread?.activeTurn;
        // A stopped turn drops the message, and an agent that has ended its turn starts the message
        // as a turn of its own, which OpenBot did not start. The message then waits in the queue.
        if (!thread || !turn || turn.id !== getString(params, "expectedTurnId") || turn.stopped || turn.completing)
          return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
        const blocks = yield* promptBlocksEffect(params);
        yield* steer(this.#sessionConnection(thread), {
          sessionId: threadId,
          messageId: getString(params, "clientUserMessageId"),
          blocks,
        });
        turn.lastActivityAt = Date.now();
        return yield* providerSync(() => decoder({ turnId: turn.id }));
      }
      case "turn/interrupt": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        // A closed idle session has no turn to stop.
        if (this.#threads.isReleased(threadId)) return yield* providerSync(() => decoder({}));
        const thread = yield* providerSync(() => this.#requireThread(threadId));
        const turn = thread.activeTurn;
        const requestedTurnId = getString(params, "turnId");
        if (!turn || (requestedTurnId !== null && requestedTurnId !== turn.id))
          return yield* providerSync(() => decoder({}));
        turn.stopped = true;
        const cancel = providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id }));
        if (turn.unprompted) {
          // No prompt answers for the agent's own turn, so its open tool calls end as stopped.
          turn.abandoned = true;
          yield* cancel.pipe(Effect.ignore);
          yield* this.#completeTurn(thread, turn, "interrupted", null);
        } else if (this.#flavor.cancelLocallyThenResume) {
          yield* cancel.pipe(Effect.ensuring(this.#abandonTurn(thread, turn, "interrupted", null)));
        } else {
          yield* cancel;
          // An agent can ignore the cancel (OpenCode, #2858). The turn then ends here after a grace.
          yield* Effect.forkIn(
            Effect.sleep(ACP_STOP_GRACE_MS).pipe(Effect.andThen(this.#abandonTurn(thread, turn, "interrupted", null))),
            this.#scope,
          );
        }
        return yield* providerSync(() => decoder({}));
      }
      case "thread/compact/start":
        return yield* providerSync(() => decoder({}));
      default:
        return yield* providerFailure(new Error(`ACP adapter does not implement ${method}.`));
    }
  });

  notify(): void {
    // ACP initialization is a request/response exchange without a follow-up notification.
  }

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

  /** The agent's own models, then the additional ones it does not list itself. */
  readonly #discoverModels = Effect.fn("AcpAgentClient.discoverModels")(function* (
    this: AcpAgentClient,
    timeoutMs?: number,
  ): Effect.fn.Return<AcpModel[], ProviderClientOperationError> {
    const [listed, additional] = yield* Effect.all(
      [this.#configuration.discoverModels(timeoutMs), this.options.additionalModels?.() ?? Effect.succeed([])],
      { concurrency: "unbounded" },
    );
    // An agent that lists no model still reports that: the additional models must not hide it.
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
    const signInPrompt = Deferred.makeUnsafe<void>();
    this.#signInPrompt = signInPrompt;
    try {
      // A saved key's `authenticate` gets the same wait: a server that never answers it kept the row connecting.
      providerResult(
        yield* Effect.result(
          (this.options.authenticate?.(connection, initialization) ?? Effect.void).pipe(startTimeout),
        ),
      );
      const discovery = yield* Effect.raceFirst(
        Effect.result(this.#discoverModels(timeoutMs)),
        Deferred.await(signInPrompt).pipe(Effect.as(null)),
      );
      if (!discovery) {
        this.#signedIn = false;
        return;
      }
      this.#models = providerResult(discovery);
      if (this.#models.length === 0 && !this.options.allowNoModels) {
        throw new Error(sourceText("error.provider.acpNoModels"));
      }
      this.#signedIn = true;
    } catch (error) {
      if (isAuthenticationError(error)) {
        const keyRefused = this.options.savedKeyRefusedMessage?.();
        if (keyRefused) return yield* providerFailure(new ProviderSignInError({ message: keyRefused }));
        this.#signedIn = false;
        return;
      }
      return yield* providerFailure(error);
    } finally {
      this.#signInPrompt = null;
    }
  });

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
        clientCapabilities: OPENBOT_ACP_CLIENT_CAPABILITIES,
        clientInfo: this.#flavor.clientInfo ?? OPENBOT_ACP_CLIENT_INFO,
      }),
    );
  }

  /**
   * A process for one session (`AcpFlavor.sessionProcesses`), started and signed in as the agent's
   * own process is. Its end marks the session to open again, so the next turn resumes it on a new one.
   */
  readonly #startSessionProcess = Effect.fn("AcpAgentClient.startSessionProcess")(function* (
    this: AcpAgentClient,
    owner: () => AcpThread | null,
  ): Effect.fn.Return<AcpConnection, ProviderClientOperationError> {
    const transport: AcpConnection = this.#newTransport(() => {
      const thread = owner();
      if (thread?.transport === transport) thread.needsResume = true;
    });
    const startTimeout = this.#startTimeout(this.#startTimeoutMs ?? this.#requestTimeoutMs);
    yield* Effect.gen({ self: this }, function* () {
      yield* providerSync(() => transport.start());
      const connection = yield* providerSync(() => transport.requireConnection());
      const initialization = yield* this.#initializeConnection(connection).pipe(startTimeout);
      yield* (this.options.authenticate?.(connection, initialization) ?? Effect.void).pipe(startTimeout);
    }).pipe(
      // Read before the stop: a stopped process no longer says how it ended.
      Effect.catch((failure) => this.#explainSessionEnd(transport, failure.cause).pipe(Effect.flatMap(Effect.fail))),
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : transport.stop(Effect.void).pipe(Effect.ignore))),
    );
    return transport;
  });

  /** The failure of a session's own process, with how that process ended when it ended. */
  #explainSessionEnd(transport: AcpConnection, error: unknown): Effect.Effect<ProviderClientOperationError> {
    return transport.explainEnd(error, transport.ended).pipe(
      Effect.catch(() => Effect.succeed(error)),
      Effect.map(providerFailure),
    );
  }

  /** Opens a held session again, with its own settings, in place of the one that needs a resume. */
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

  /** The process that runs this session. */
  #sessionConnection(thread: AcpThread): ClientSideConnection {
    return thread.transport ? thread.transport.requireConnection() : this.#requireConnection();
  }

  /** Loads a session for legacy metadata reads without retaining provider turns in memory. */
  readonly #readableThreadEffect = Effect.fn("AcpAgentClient.readableThread")(function* (
    this: AcpAgentClient,
    id: string,
    params: unknown,
  ): Effect.fn.Return<AcpThread | null, ProviderClientOperationError> {
    const held = this.#threads.get(id);
    if (held) return yield* providerSync(() => held);
    if (!getString(params, "cwd")) return null;
    // A resume that is already loading this session opens it for a turn, not for this read.
    const resuming = this.#startingThreads.has(id);
    try {
      providerResult(yield* Effect.result(this.#ensureInitializedEffect()));
      if (!this.#loadsSessions) return null;
      providerResult(yield* Effect.result(this.#startThread(params, true)));
    } catch (error) {
      // The next turn replaces the missing session, so the user has nothing to act on.
      if (!(error instanceof MissingAcpSessionError)) {
        this.emit("diagnostic", this.#redact(`ACP session load for a read failed: ${String(error)}`));
      }
      return null;
    }
    const thread = this.#threads.get(id) ?? null;
    // A session loaded only for a read is idle from the start, so the idle limit counts it.
    if (thread && !resuming && thread.idleSince === 0 && !thread.activeTurn) yield* this.#threads.markIdle(thread);
    return yield* providerSync(() => thread);
  });

  /** Whether the agent answers `session/load`, which it advertises in its initialization. */
  get #loadsSessions(): boolean {
    return this.#initialization?.agentCapabilities?.loadSession === true;
  }

  /** Whether the agent can resume without replaying its transcript. */
  get #supportsSessionResume(): boolean {
    return this.#initialization?.agentCapabilities?.sessionCapabilities?.resume != null;
  }

  /** Whether the agent advertises `additionalDirectories`. Grok refuses them unadvertised (#1729). */
  get #acceptsAdditionalDirectories(): boolean {
    return this.#initialization?.agentCapabilities?.sessionCapabilities?.additionalDirectories != null;
  }

  /**
   * Whether the session got other `additionalDirectories` than these params send. A history read
   * sends no roots and keeps the session as it is.
   */
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
    // The MCP servers and the workspace roots are fixed when a session opens, so a changed Computer
    // Use switch or a changed folder list loads the session again: Antigravity's file tools reach only
    // the roots of the session (#3843). A session with a turn keeps them until a later resume.
    if (
      held &&
      !recovering &&
      !held.activeTurn &&
      (held.computerUse !== computerUseParam(params) || this.#workspaceRootsChanged(held, params))
    ) {
      yield* this.#threads.close(held).pipe(toProviderClientOperationError);
    }
    // A thread this client already holds takes the caller's settings even though no session is
    // opened for them: the loader may have been a `thread/read`, which carries none of its own, and
    // the turn that follows must not run on the settings of whoever loaded the session first.
    else if (held && !recovering) {
      held.developerInstructions = getString(params, "developerInstructions") ?? held.developerInstructions;
      // A session loaded for a read has no agent. Its MCP servers keep that until it opens again.
      held.agentId ??= mcpAgentParam(params);
      yield* this.#configuration.applyConfig(
        held,
        getString(params, "model"),
        getString(params, "effort"),
        this.#models,
      );
      return { thread: { id: requestedThreadId } };
    }
    // One load per session id, however many callers ask for it. Boot recovery reads a session while
    // the first drain resumes it, and two `session/load` calls would leave two threads and two MCP
    // bridge sessions under one id, of which only the last is reachable.
    const starting = this.#startingThreads.get(requestedThreadId);
    if (starting) return yield* Deferred.await(starting);
    const completion = Deferred.makeUnsafe<{ thread: { id: string } }, ProviderClientOperationError>();
    this.#startingThreads.set(requestedThreadId, completion);
    // A session's own process ends with its harness, which can still run the stopped turn.
    if (recovering && held.transport) yield* held.transport.stop(Effect.void).pipe(Effect.ignore);
    const exit = yield* Effect.exit(this.#openThread(params, true));
    // session/resume closes the old Antigravity harness and restores its saved trajectory.
    // Keep its bridge until the replacement succeeds, so a failure can be retried in this session.
    if (recovering && Exit.isSuccess(exit)) held.mcp.close();
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
      // Reported as a missing session, which is what it is for the caller: the agent cannot give
      // this session back, so the recovery that replaces it runs now rather than after a protocol
      // error the user would have to read.
      return yield* providerFailure(new Error(`Unknown ACP session: ${requestedThreadId}`));
    }
    const cwd = yield* providerSync(() => requiredString(params, "cwd"));
    const dynamicTools = getArray(params, "dynamicTools").filter(isDynamicToolNamespace);
    const computerUse = computerUseParam(params);
    const agentId = mcpAgentParam(params);
    let threadRef: AcpThread | null = null;
    let transport: AcpConnection | null = null;
    let retained = false;
    return yield* Effect.acquireUseRelease(
      this.#bridge
        .createSession(
          requestedThreadId ?? randomUUID(),
          dynamicTools,
          () => threadRef?.activeTurn?.id ?? null,
          (call, signal) => this.#callDynamicTool(call, signal),
          this.#flavor.mcpServersPerDirectory ? cwd : undefined,
        )
        .pipe(toProviderClientOperationError),
      (mcp) =>
        Effect.gen({ self: this }, function* () {
          try {
            if (this.#flavor.sessionProcesses)
              transport = providerResult(yield* Effect.result(this.#startSessionProcess(() => threadRef)));
            const sessionTransport = transport;
            const connection = () =>
              sessionTransport ? sessionTransport.requireConnection() : this.#requireConnection();
            const additionalDirectories = getArray(params, "runtimeWorkspaceRoots").filter(isString);
            // Sent only to an agent that advertises them: Grok 1.0.60 refuses them on every session
            // request, so each new Grok session failed.
            const directories = this.#acceptsAdditionalDirectories ? { additionalDirectories } : {};
            let id: string;
            let configOptions: SessionConfigOption[];
            let currentModelId: string | null;
            // OpenBot's bridge servers last: all providers key MCP servers by name, so a user
            // configuration that reached one of those names would take the agent's own tools away.
            const handoff = acpMcpServers(
              providerResult(
                yield* Effect.result(
                  usableMcpServers(
                    agentMcpServers(this.options.mcpServers?.() ?? [], computerUse),
                    this.options.mcpToolRuntimes?.(),
                    this.options.mcpEndpoint,
                    agentId,
                  ).pipe(toProviderClientOperationError),
                ),
              ),
            );
            this.options.reportMcpDrops?.(this.provider, handoff.dropped);
            const mcpServers = [...handoff.servers, ...mcp.servers];
            const enableMcpServers = this.#flavor.enableMcpServers;
            if (enableMcpServers) {
              const names = mcp.servers.map((server) => server.name);
              // A failed change only goes to the log: the check after the session request reports its effect.
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
            if (resume && requestedThreadId) {
              const response = providerResult(
                yield* Effect.result(
                  this.#restoreSessionEffect(
                    connection,
                    { sessionId: requestedThreadId, cwd, ...directories, mcpServers },
                    this.#supportsSessionResume ? "resume" : "load",
                  ),
                ),
              );
              id = requestedThreadId;
              configOptions = response.configOptions ?? [];
              currentModelId = currentModelFromSessionSetup(response);
            } else {
              const response = providerResult(
                yield* Effect.result(providerCall(() => connection().newSession({ cwd, ...directories, mcpServers }))),
              );
              id = response.sessionId;
              configOptions = response.configOptions ?? [];
              currentModelId = currentModelFromSessionSetup(response);
            }
            // The turn would run with no OpenBot tools, and the model would make up their errors (#3058).
            if (this.#flavor.mcpServersLoadWithSession && !mcp.reached())
              throw new Error(sourceText("error.provider.acpMcpNotLoaded", { provider: this.#label }));
            mcp.setThreadId(id);
            const thread: AcpThread = {
              id,
              cwd,
              developerInstructions: getString(params, "developerInstructions") ?? "",
              instructionsSent: null,
              contextUsed: null,
              promptsSinceInstructions: 0,
              configOptions,
              currentModelId,
              mcp,
              activeTurn: null,
              needsResume: false,
              transport: sessionTransport,
              dynamicTools,
              workspaceRoots: additionalDirectories,
              computerUse,
              agentId,
              idleRelease: null,
              idleSince: 0,
              restore: { cwd, ...directories, mcpServers },
              shownIds: new Set(),
              backgroundUntil: 0,
              backgroundUpdatedAt: null,
              backgroundSkipUntil: 0,
              backgroundReplay: null,
            };
            threadRef = thread;
            providerResult(
              yield* Effect.result(
                this.#configuration.applyConfig(
                  thread,
                  getString(params, "model"),
                  getString(params, "effort"),
                  this.#models,
                ),
              ),
            );
            // A session's own process outlives a stop of the client that started it, and the pool
            // that would end it is cleared.
            if (sessionTransport && !this.running) throw new Error("ACP client is not running.");
            this.#threads.add(thread);
            retained = true;
            return { thread: { id } };
          } catch (error) {
            return yield* transport ? yield* this.#explainSessionEnd(transport, error) : providerFailure(error);
          }
        }),
      (mcp) =>
        Effect.gen(function* () {
          if (retained) return;
          mcp.close();
          if (transport) yield* transport.stop(Effect.void).pipe(Effect.ignore);
        }),
    );
  });

  /**
   * An agent that follows the protocol answers a session missing from its store with `-32002`, the
   * resource-not-found error, naming the session. Cline does.
   *
   * OpenCode answers a session missing from its store with the same `-32603` "OpenCode service
   * failure" as a fault of its internal server. Only a `session/list` that answers in full without
   * the session shows it is missing: the caller then replaces it and hands it the transcript. A
   * session that is listed, a list that fails, or an OpenCode without `session/list` leaves the
   * session kept: one more attempt, then the fault is reported.
   *
   * `session/resume` gets the same OpenCode check. OpenCode 1.19.3 advertises resume, and it cannot
   * read a session that OpenCode 2.0 wrote in its `session_v2` table: each resume failed this way and
   * the agent never got a new session.
   *
   * OpenCode 2.1.1 can fail a `session/resume` in its first seconds with "Internal service failure"
   * and `ServiceUnavailableError`, because its plugins have not started yet (OpenCode issue #57204).
   * The session is there, and a resume a few seconds later works, so OpenBot tries once more.
   */

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
    let recovery: "wait-for-start" | "list-sessions" | null = null;
    try {
      return providerResult(yield* Effect.result(providerSync(connection).pipe(Effect.flatMap(restore))));
    } catch (error) {
      // For `thread/resume` and `turn/start`, `request` forgets the session and converts this response.
      if (method === "load" && isSessionNotFound(error, request.sessionId, this.#flavor)) {
        return yield* providerFailure(new MissingAcpSessionError(`ACP session not found: ${request.sessionId}`, error));
      }
      recovery = this.#flavor.restoreFailure?.(error, method) ?? null;
      if (!recovery) return yield* providerFailure(error);
      failure = error;
    }
    if (recovery === "wait-for-start") {
      yield* Effect.sleep(RESTORE_START_RETRY_MS);
      // The process can have stopped during the wait; this reports that instead of a closed stream.
      const current = yield* providerSync(connection);
      return yield* restore(current);
    }
    const listing = yield* this.#sessionListingEffect(yield* providerSync(connection), request);
    if (listing === "absent")
      return yield* providerFailure(
        new MissingAcpSessionError(
          `OpenCode session not found: ${request.sessionId} (OpenCode service failure)`,
          failure,
        ),
      );
    yield* Effect.sleep(RESTORE_LIST_RETRY_MS);
    try {
      // The process can have stopped during the wait; this reports that instead of a closed stream.
      return providerResult(yield* Effect.result(providerSync(connection).pipe(Effect.flatMap(restore))));
    } catch (error) {
      if (this.#flavor.restoreFailure?.(error, method) !== "list-sessions") return yield* providerFailure(error);
      return yield* providerFailure(new Error(sourceText("error.provider.opencodeServiceFailure"), { cause: error }));
    }
  });

  /** Queue one replay fragment without retaining the provider transcript in this client. */
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

  /** Drain one fragment at a time. The queue, rather than a Promise chain, is the memory bound. */
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

  /** Converts ACP replay notifications into storage fragments, with no live turn side effects. */
  #historyUpdate(replay: HistoryReplay, notification: SessionNotification): void {
    replay.hasUpdates = true;
    const update = notification.update;
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

  /** Whether the agent's `session/list` for the session's directory holds the session. */

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
    // Counted before the session opens again, because that sends its own `session/load`.
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
    let thread = yield* providerSync(() => this.#requireThread(threadId));
    // A background replay that runs can start a turn of the agent. The prompt waits for it before it
    // opens the session again, because that replaces the thread that the replay writes to.
    if (thread.backgroundReplay) yield* Deferred.await(thread.backgroundReplay);
    if (thread.needsResume && !thread.activeTurn) {
      yield* this.#reopenThread(thread);
      thread = yield* providerSync(() => this.#requireThread(threadId));
    }
    if (thread.activeTurn) return yield* providerFailure(this.#turnActiveError(thread.activeTurn));
    yield* this.#applyTurnSettings(thread, params);
    this.#publishSessionSettings(thread);
    const turnId = getString(params, "clientTurnId") ?? getString(params, "clientUserMessageId") ?? randomUUID();
    const blocks = yield* promptBlocksEffect(params);
    yield* providerSync(() => this.#requireServedModel(thread));
    // The session keeps the instructions in its context, so a prompt carries them only when the
    // session lacks them. An agent that reports no context size cannot show a compaction, so it
    // gets them again after a number of prompts.
    thread.promptsSinceInstructions += 1;
    if (
      thread.developerInstructions &&
      (thread.instructionsSent !== thread.developerInstructions ||
        (thread.contextUsed === null && thread.promptsSinceInstructions > ACP_INSTRUCTIONS_REFRESH_PROMPTS))
    ) {
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

  /** The model, effort and session settings that a turn asks for. Applied again after a resume in the turn. */
  readonly #applyTurnSettings = Effect.fn("AcpAgentClient.applyTurnSettings")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    params: unknown,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    yield* this.#configuration.applyConfig(
      thread,
      getString(params, "model"),
      getString(params, "effort"),
      this.#models,
    );
    const overrides = getRecord(params, "sessionSettings");
    for (const [configId, value] of Object.entries(overrides ?? {})) {
      if (typeof value !== "boolean" && typeof value !== "string")
        return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingInvalid")));
      const option = sessionSettingsSnapshot(thread.configOptions).options.find((entry) => entry.id === configId);
      // A provider update can remove an option or choice. Keep the saved override in the
      // store and report the effective value for correction, without blocking the prompt.
      const available =
        option?.type === "boolean"
          ? typeof value === "boolean"
          : option?.type === "select" &&
            typeof value === "string" &&
            option.options.some((choice) => choice.value === value);
      if (available && option?.currentValue !== value) yield* this.#configuration.set(thread, configId, value);
    }
  });

  /** A turn of the agent's own ends when OpenBot sees it end, so a message waits for it rather than joining it. */
  #turnActiveError(turn: AcpTurn): Error {
    return turn.unprompted
      ? new ProviderTurnActiveError(this.#label)
      : new Error("The ACP thread already has an active turn.");
  }

  #beginTurn(
    thread: AcpThread,
    turnId: string,
    { unprompted, answerOptional }: { unprompted: boolean; answerOptional: boolean },
  ): AcpTurn {
    const currentSecond = Date.now() / 1_000;
    const startedAt = Math.max(currentSecond, this.#lastTurnStartedAt + 0.001);
    this.#lastTurnStartedAt = startedAt;
    const turn: AcpTurn = {
      id: turnId,
      // History timestamps use provider seconds, not JavaScript milliseconds.
      startedAt,
      itemId: `${turnId}:assistant`,
      thoughtItemId: `${turnId}:thought`,
      text: "",
      thought: "",
      thoughtStarted: false,
      receivedOutput: false,
      reasoned: false,
      interruptedAnswer: null,
      providerError: null,
      sdkFailureAt: null,
      answerOptional,
      messages: [],
      toolNames: new Map(),
      toolKinds: new Map(),
      toolItems: new Map(),
      stopped: false,
      completing: false,
      task: null,
      lastActivityAt: Date.now(),
      waitingOnUser: 0,
      abandoned: false,
      reportedCost: null,
      unprompted,
      textMessageId: null,
      textMessageStart: 0,
    };
    thread.activeTurn = turn;
    this.#threads.holdForTurn(thread);
    this.emit("notification", {
      method: "turn/started",
      params: {
        threadId: thread.id,
        turn: { id: turn.id, status: "inProgress" },
        // `unprompted` tells the lifecycle that no delivery started this turn.
        ...(unprompted ? { unprompted } : {}),
      },
    });
    return turn;
  }

  /** Refuses a prompt whose endpoint was taken out while this turn was prepared. */
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
      const send = () =>
        providerCall(() => this.#sessionConnection(thread).prompt({ sessionId: thread.id, prompt })).pipe(
          Effect.result,
        );
      let response = providerResult(yield* send());
      while (providerResult(yield* Effect.result(this.#leaveOutFailedMcpServer(thread, turn, response, params))))
        response = providerResult(yield* send());
      if (thread.activeTurn !== turn || turn.completing) return;
      // `promptId` names this result: a delivery that runs again keeps its turn ID.
      if (response.usage)
        this.emit("notification", {
          method: "openbot/usage",
          params: {
            threadId: thread.id,
            turnId: turn.id,
            promptId: randomUUID(),
            usage: response.usage,
            ...(turn.reportedCost === null ? {} : { cost: turn.reportedCost }),
          },
        });
      // A flavor can fail a turn that ended with no answer (OpenCode). A turn told not to answer ends
      // empty on purpose, and an error there costs no answer the user waits for.
      const emptyAnswerFailure = this.#flavor.emptyAnswerFailure;
      if (emptyAnswerFailure && response.stopReason === "end_turn" && !turn.receivedOutput && !turn.answerOptional) {
        yield* this.#completeTurn(thread, turn, "failed", emptyAnswerFailure(turn.reasoned));
        return;
      }
      const sdkHarness = this.#flavor.sdkHarness;
      if (sdkHarness && !turn.providerError && !turn.stopped && response.stopReason === "end_turn") {
        // The server's SDK failed the prompt and sent its message as the answer (1.3.0). The text
        // before the failure is the partial answer; the rest is the message.
        const failureAt = turn.sdkFailureAt ?? (sdkHarness.answerIsFailure.test(turn.text) ? 0 : null);
        const failure = failureAt === null ? "" : turn.text.slice(failureAt).trim();
        if (failureAt !== null) {
          turn.providerError = sdkHarness.turnFailure(failure || turn.text.trim());
          turn.text = failure ? turn.text.slice(0, failureAt) : "";
        }
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
    } catch (error) {
      // A session's own process that ended names how it ended, as the agent's process does.
      const transport = thread.transport;
      const failure = transport && !turn.stopped ? (yield* this.#explainSessionEnd(transport, error)).cause : error;
      yield* this.#completeTurn(thread, turn, turn.stopped ? "interrupted" : "failed", turn.stopped ? null : failure);
    }
  });

  /**
   * Antigravity ends the whole turn when one MCP server does not start, such as a server that asks
   * for a sign-in that OpenBot does not hold and answers 401 (#3824). The user then cannot use Gemini
   * at all until they find and remove the server. Other providers start without that server.
   *
   * When the failed server is one that OpenBot gave, the user is told which server was left out, and
   * the session opens again without it. The caller then sends the prompt again. Only a failure that
   * came before any output is retried: the user saw nothing of it. Only this session leaves the
   * server out: a new or reopened session gets it again, so a sign-in or a fix takes effect with the
   * fresh sessions that every MCP change starts. A server from the user's own Antigravity
   * configuration is not OpenBot's to leave out, so its failure stays the turn's error.
   */
  readonly #leaveOutFailedMcpServer = Effect.fn("AcpAgentClient.leaveOutFailedMcpServer")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    response: PromptResponse,
    params: unknown,
  ): Effect.fn.Return<boolean, ProviderClientOperationError> {
    const mcpLoadFailure = this.#flavor.sdkHarness?.mcpLoadFailure;
    if (
      !mcpLoadFailure ||
      thread.activeTurn !== turn ||
      turn.completing ||
      turn.stopped ||
      response.stopReason !== "end_turn" ||
      turn.sdkFailureAt !== 0 ||
      turn.thoughtStarted ||
      turn.toolItems.size > 0 ||
      // `session/load` would replay the history into this turn.
      !this.#supportsSessionResume
    )
      return false;
    const failure = mcpLoadFailure(turn.text);
    const server = failure
      ? thread.restore.mcpServers.find(
          (entry) => entry.name === failure.name && !thread.mcp.servers.some((bridge) => bridge === entry),
        )
      : undefined;
    if (!failure || !server) return false;
    const configured = this.options
      .mcpServers?.()
      .find((config) => providerMcpServerName(config.name) === failure.name);
    this.options.reportMcpDrops?.(this.provider, [
      {
        name: configured?.name ?? failure.name,
        reason: "failed_to_start",
        detail: sourceText("error.backend.mcpServerFailedToStart", { reason: failure.reason }),
      },
    ]);
    const restore = { ...thread.restore, mcpServers: thread.restore.mcpServers.filter((entry) => entry !== server) };
    const model = thread.currentModelId;
    const restored = yield* this.#restoreSessionEffect(
      () => this.#sessionConnection(thread),
      { sessionId: thread.id, ...restore },
      "resume",
    );
    thread.restore = restore;
    thread.configOptions = restored.configOptions ?? thread.configOptions;
    thread.currentModelId = currentModelFromSessionSetup(restored) ?? thread.currentModelId;
    // The session that opens again has the model of the thread, then the settings of this turn.
    yield* this.#configuration.applyConfig(thread, model, null, this.#models);
    yield* this.#applyTurnSettings(thread, params);
    this.#publishSessionSettings(thread);
    turn.text = "";
    turn.sdkFailureAt = null;
    turn.receivedOutput = false;
    turn.textMessageId = null;
    turn.textMessageStart = 0;
    return true;
  });

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
    if (thread.activeTurn) thread.activeTurn.lastActivityAt = Date.now();
    const update = notification.update;
    if (update.sessionUpdate === "config_option_update") {
      thread.configOptions = update.configOptions;
      this.#publishSessionSettings(thread);
      return;
    }
    // A compaction replaces the prompt that carried the instructions with a summary. The context
    // shrinks, so a large drop counts as one when the agent sends no compaction update.
    // The update is also the context fill. Its cost is the session's total, which OpenCode sends
    // before the prompt result. Antigravity sends the last one after a turn that OpenBot already ended.
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
    this.#applyTurnUpdate(thread, turn, update);
  }

  /** Applies one output update of the agent to a turn: a live one, or one that a background replay found. */
  #applyTurnUpdate(thread: AcpThread, turn: AcpTurn, update: SessionUpdate): void {
    if (this.#flavor.unsentBackgroundTurns) {
      const id = shownEntryId(update);
      if (id) thread.shownIds.add(id);
    }
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      // The agent's own transport error sent as answer text (Cursor, #3334).
      if (this.#flavor.noiseChunk?.test(update.content.text)) return;
      // An exhausted quota sent as answer text, and a turn then ended as a success (Antigravity).
      const quota = this.#flavor.sdkHarness?.quota(update.content.text) ?? null;
      if (quota !== null) {
        turn.receivedOutput = true;
        turn.providerError = quota;
        return;
      }
      // A harness reports a dropped stream as answer text, and then sends the retried answer (#1471).
      // The report gets its own muted item, so it is not joined to the answer around it. When no
      // retried answer comes, the partial reply and the report become the answer.
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
      if (update.content.text) this.#completeThought(thread, turn);
      // The text of two steps stays one answer, as two paragraphs. Joined as it came, it showed as one line.
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
      if (messageId && (text || !turn.textMessageId)) turn.textMessageId = messageId;
      if (update.content.text.trim()) {
        turn.receivedOutput = true;
        turn.interruptedAnswer = null;
      }
      // An agent can keep session/prompt open while background tasks run (Antigravity). Its text must
      // not wait for that response. A later tool/thought boundary can still classify it as commentary.
      // Text after an SDK failure is the failure, which the turn reports when it ends.
      // Antigravity can end a turn on a failed MCP server start before its stderr line arrives. That
      // text is the failure, not an answer, so it is not shown while the turn can still try again.
      if (turn.sdkFailureAt === null && !turn.text && this.#flavor.sdkHarness?.mcpLoadFailure(text))
        turn.sdkFailureAt = 0;
      if (this.#flavor.streamAnswerBeforePromptReturns && text && turn.sdkFailureAt === null) {
        if (!turn.text)
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
          params: { threadId: thread.id, turnId: turn.id, itemId: turn.itemId, delta: text },
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
      // A tool call ends the step, so thinking after it is a new thought, not text added to the old one.
      if (update.sessionUpdate === "tool_call") {
        this.#completeThought(thread, turn);
        this.#completeMessage(thread, turn, "commentary");
      }
      // ACP updates are partial; OpenCode omits the name when a tool finishes.
      const name = update.name ?? update.title ?? turn.toolNames.get(update.toolCallId) ?? "tool";
      turn.toolNames.set(update.toolCallId, name);
      const toolKind = update.kind ?? turn.toolKinds.get(update.toolCallId) ?? "other";
      turn.toolKinds.set(update.toolCallId, toolKind);
      const status = update.status ?? turn.toolItems.get(update.toolCallId)?.status;
      const item: ThreadItem = {
        ...(turn.toolItems.get(update.toolCallId) ?? {}),
        id: update.toolCallId,
        type: "toolCall",
        name,
        toolKind,
        ...(status === undefined ? {} : { status }),
        arguments: update.rawInput ?? turn.toolItems.get(update.toolCallId)?.arguments,
        result: update.rawOutput ?? turn.toolItems.get(update.toolCallId)?.result,
      };
      turn.toolItems.set(update.toolCallId, item);
      this.emit("notification", {
        method: update.status === "completed" || update.status === "failed" ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          filePaths: update.locations?.map((location) => location.path),
          item,
        },
      });
      if (update.status === "completed" || update.status === "failed") {
        turn.messages.push(item);
        turn.toolItems.delete(update.toolCallId);
      }
      if (this.#flavor.unsentBackgroundTurns && update.status === "completed" && startsBackgroundTask(update.rawOutput))
        this.#watchBackground(thread);
      return;
    }
    if (update.sessionUpdate === "plan") {
      this.emit("notification", {
        method: PLAN_UPDATED_METHOD,
        params: { threadId: thread.id, turnId: turn.id, explanation: null, plan: acpPlanSteps(update.entries) },
      });
    }
  }

  // ACP cannot identify final text while streaming. A later step boundary assigns its phase.
  // Antigravity also publishes provisional answer text because its prompt can wait on background work.
  #completeMessage(thread: AcpThread, turn: AcpTurn, phase: "commentary" | "final_answer"): void {
    if (phase === "final_answer") {
      if (!turn.text.trim() && turn.interruptedAnswer) turn.text = turn.interruptedAnswer;
      turn.interruptedAnswer = null;
    }
    if (!turn.text) return;
    const item = { id: turn.itemId, type: "agentMessage", phase, text: turn.text } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.text = "";
    turn.textMessageId = null;
    turn.textMessageStart = 0;
    turn.itemId = `${turn.id}:assistant:${turn.messages.length}`;
  }

  #appendThought(thread: AcpThread, turn: AcpTurn, text: string): void {
    if (!this.#flavor.thoughtsInsideAnswer) this.#completeMessage(thread, turn, "commentary");
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

  /**
   * Ends a turn that the agent did not end. The prompt may still run in the agent, so the next
   * prompt opens the session again first, and a tool that the old prompt asks for is refused. An
   * agent that cannot give a session back keeps it, because opening it again would replace it.
   */
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

  /**
   * Fails a turn that sends nothing while no tool call runs and no question waits for the user.
   *
   * A silent prompt of an agent that keeps it open for background tasks can still be working, so its
   * turn goes on, and `#endIfUnresponsive` checks the process instead.
   */
  readonly #watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
  ) {
    const limit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;
    let answeredAt = 0;
    // A stopped turn ends by its stop, as interrupted, and not as a stall.
    while (thread.activeTurn === turn && !turn.completing && !turn.stopped) {
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
      yield* providerCall(() => this.#sessionConnection(thread).cancel({ sessionId: thread.id })).pipe(Effect.ignore);
      yield* this.#abandonTurn(
        thread,
        turn,
        "failed",
        sourceText("error.agent.turnStalled", {
          provider: this.options.providerName?.(thread.currentModelId) ?? this.#label,
        }),
      );
    }
  });

  /**
   * Ends a process that stopped answering, so the runtime starts a new one as it does after an exit.
   * Without this the hung process stayed the provider's client, and every turn waited on it until the
   * user restarted the provider (#3520). True when it ended the process.
   *
   * One request that timed out is not enough: a request can wait on the network. So one `session/list`
   * probes the process. That request is local. Only an agent that keeps a prompt open while it serves
   * other requests is probed: another agent can answer the probe only after its slow request.
   *
   * A session with a process of its own probes that process, and only that process ends.
   */
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
      if (turn) yield* this.#abandonTurn(thread, turn, "failed", message);
      thread.needsResume = true;
      yield* transport.stop(Effect.void).pipe(Effect.ignore);
      return true;
    }
    this.emit("exit", new Error(sourceText("error.provider.acpUnresponsive", { provider: this.#label })));
    // A warm generation client has no runtime that stops it, and it is used again while it runs.
    // The stop closes the scope of this fiber, so it runs detached.
    yield* Effect.forkDetach(this.stop().pipe(Effect.ignore), { startImmediately: true });
    return true;
  });

  /** Watches a session whose background task can start a turn that the agent sends no update for. */
  #watchBackground(thread: AcpThread): void {
    if (!this.#loadsSessions) return;
    const watching = thread.backgroundUntil > 0;
    thread.backgroundUntil = Date.now() + ACP_BACKGROUND_WATCH_MS;
    if (watching) return;
    this.#threads.holdForTurn(thread);
    Effect.runFork(this.#watchBackgroundTurns(thread).pipe(Effect.forkIn(this.#scope)));
  }

  /**
   * Shows the turns that the agent starts for a finished background task (`unsentBackgroundTurns`).
   * The session's `updatedAt` in `session/list` changes when such a turn starts and when it ends.
   * A `session/load` then replays the session, and its entries after the last one that the chat
   * showed go through the live update path, in a turn that OpenBot ends when the session is quiet.
   */
  readonly #watchBackgroundTurns = Effect.fn("AcpAgentClient.watchBackgroundTurns")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
  ) {
    const stallLimit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;
    // A turn of the agent's own ends only here, so the watch goes on while one is open.
    while (
      this.#threads.get(thread.id) === thread &&
      (Date.now() < thread.backgroundUntil || thread.activeTurn?.unprompted === true)
    ) {
      yield* Effect.sleep(ACP_BACKGROUND_POLL_MS);
      const active = thread.activeTurn;
      // A prompt's own updates show its turn. The replay after it finds nothing new.
      if ((active && !active.unprompted) || this.#openingTurns.has(thread.id)) continue;
      const updatedAt = yield* this.#sessionUpdatedAt(thread).pipe(Effect.orElseSucceed(() => null));
      if (updatedAt !== null && updatedAt !== thread.backgroundUpdatedAt) {
        const replayed = yield* this.#replayBackground(thread).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              this.emit("diagnostic", this.#redact(`ACP background replay failed: ${failureText(error)}`));
              // The next poll tries the same change again: it can be the end of the turn.
              return false;
            }),
          ),
        );
        // A prompt that started during `session/list` shows its own turn; the change waits for the next poll.
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

  /** The session's `updatedAt` on the first `session/list` page, which lists the latest first. */
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

  /**
   * Loads the session again and shows what its background task added. A prompt waits meanwhile.
   * False when a prompt started first: its live updates must not go into the replay.
   */
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
    // The agent goes on with its replay after a timeout, so the session's updates stay apart, and a
    // prompt waits, until the load answers. The prompt's own `turn/start` time limit still applies.
    // A load that answers in time releases them only after its entries are applied: a waiting prompt
    // must not start its turn before the replay starts the agent's.
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

  /**
   * Applies the replayed entries after the last one that the chat showed, and the updates of the
   * tool calls that are still open. The replay lists each message and tool call by its ID.
   */
  #applyBackgroundEntries(thread: AcpThread, updates: SessionUpdate[]): void {
    const ids = updates.map(shownEntryId);
    const lastShown = ids.findLastIndex((id) => id !== null && thread.shownIds.has(id));
    // Without a shown entry, OpenBot cannot tell which part of the session is new.
    if (lastShown < 0) return;
    const fresh = new Set(ids.slice(lastShown + 1).filter((id) => id !== null && !thread.shownIds.has(id)));
    if (Date.now() < thread.backgroundSkipUntil) {
      for (const id of fresh) if (id) thread.shownIds.add(id);
      return;
    }
    const open = thread.activeTurn?.unprompted ? thread.activeTurn : null;
    // The text that the turn shows last can still grow, while no tool call or other message ends it.
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

  /** Runs a request that waits for the user. The turn does not count as stalled meanwhile. */
  #waitForUser<A, E>(turn: AcpTurn | null | undefined, request: Effect.Effect<A, E>): Effect.Effect<A, E> {
    if (!turn) return request;
    return Effect.suspend(() => {
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

  readonly #completeTurn = Effect.fn("AcpAgentClient.completeTurn")(function* (
    this: AcpAgentClient,
    thread: AcpThread,
    turn: AcpTurn,
    status: string,
    error: unknown,
  ) {
    if (thread.activeTurn !== turn || turn.completing) return;
    turn.completing = true;
    // The agent may not have kept a prompt that failed.
    if (status === "failed") thread.instructionsSent = null;
    // The agent can still store the rest of a turn that did not complete. A replay does not show it.
    if (status !== "completed") thread.backgroundSkipUntil = Date.now() + ACP_STOPPED_OUTPUT_MS;
    // A prompt can have run tools. Never replay it. Drop the handle before publishing completion
    // so only new input can reload the session, including input already waiting in the queue.
    if (status === "failed" && isSessionNotFound(error, thread.id, this.#flavor)) {
      this.#forgetMissingSession(thread.id);
    }
    this.#completeThought(thread, turn);
    for (const item of turn.toolItems.values()) {
      // A stopped stream cannot provide another tool result. Preserve its last output without
      // reporting successful execution. A normal completion can leave background tasks active.
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
    this.#completeMessage(thread, turn, "final_answer");
    if (status === "failed" && error) {
      const detail = this.#redact(failureText(error));
      const message =
        this.#flavor.turnFailure?.(
          error,
          detail,
          (text) => this.#redact(text),
          (text) => this.emit("diagnostic", this.#redact(text)),
          thread.currentModelId,
        ) ?? detail;
      this.emit("notification", {
        method: "error",
        params: { threadId: thread.id, turnId: turn.id, message },
      });
    }
    const append = this.options.history?.append;
    if (append) {
      // Persist before clearing the active turn. A failed durable write cannot be reported as a
      // completed turn because the provider session may be released immediately afterwards.
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
    if (this.#threads.get(thread.id) === thread) yield* this.#threads.markIdle(thread);
  }, Effect.uninterruptible);

  readonly #requestPermission = Effect.fn("AcpAgentClient.requestPermission")(function* (
    this: AcpAgentClient,
    params: RequestPermissionRequest,
  ): Effect.fn.Return<RequestPermissionResponse, ProviderClientOperationError> {
    if (this.options.profileGeneration) return { outcome: { outcome: "cancelled" } };
    if (this.#historyReplays.has(params.sessionId)) return { outcome: { outcome: "cancelled" } };
    const thread = this.#threads.get(params.sessionId);
    // The user stopped this Antigravity session, and its harness can still run until the resume.
    // A tool that it asks for now must not run.
    if (thread?.needsResume && !thread.activeTurn) return { outcome: { outcome: "cancelled" } };
    const turnId = thread?.activeTurn?.id ?? randomUUID();
    const kind =
      params.toolCall.kind === "execute"
        ? "command"
        : ["edit", "delete", "move"].includes(params.toolCall.kind ?? "")
          ? "file-change"
          : "permissions";
    const requestedPermissions = kind === "permissions" ? { [params.toolCall.kind ?? "file-system"]: true } : null;
    const result = yield* this.#waitForUser(
      thread?.activeTurn,
      this.#serverRequests.call(
        `item/${kind === "command" ? "commandExecution" : kind === "file-change" ? "fileChange" : "permissions"}/requestApproval`,
        {
          threadId: params.sessionId,
          turnId,
          command: params.toolCall.kind === "execute" ? printableInput(params.toolCall.rawInput) : null,
          reason: params.toolCall.title ?? null,
          permissions: requestedPermissions,
        },
      ),
    ).pipe(toProviderClientOperationError);
    const accepted =
      isRecord(result) &&
      (result.decision === "accept" ||
        result.decision === "approved" ||
        (isRecord(result.permissions) && Object.keys(result.permissions).length > 0));
    const option = bestPermissionOption(params.options, accepted);
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
    if (sessionId && this.#historyReplays.has(sessionId)) return {};
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    const result = yield* this.#waitForUser(
      thread?.activeTurn,
      this.#serverRequests.call("item/tool/requestUserInput", {
        ...params,
        threadId: sessionId,
        turnId: thread?.activeTurn?.id ?? randomUUID(),
        sourceMethod: method,
      }),
    ).pipe(toProviderClientOperationError);
    return yield* providerSync(() => (isRecord(result) ? result : {}));
  });

  readonly #createElicitation = Effect.fn("AcpAgentClient.createElicitation")(function* (
    this: AcpAgentClient,
    params: CreateElicitationRequest,
  ): Effect.fn.Return<CreateElicitationResponse, ProviderClientOperationError> {
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
  ): Effect.fn.Return<DynamicToolResult, ProviderClientOperationError> {
    if (this.#historyReplays.has(params.threadId)) {
      return { success: false, contentItems: [{ type: "inputText", text: "History replay cannot execute tools." }] };
    }
    const result = yield* this.#serverRequests
      .call("item/tool/call", params, signal)
      .pipe(toProviderClientOperationError);
    if (!isDynamicToolResult(result))
      return yield* providerFailure(new Error("OpenBot returned an invalid dynamic tool result."));
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

const promptBlocksEffect = Effect.fn("AcpAgentClient.promptBlocks")(function* (params: unknown) {
  const blocks: ContentBlock[] = [];
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) blocks.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path)) {
      blocks.push({ type: "text", text: `Attached local file: ${item.path}` });
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

function contentMessageId(update: SessionNotification["update"]): string | null {
  if (!("messageId" in update) || typeof update.messageId !== "string" || update.messageId.length === 0) return null;
  return update.messageId;
}

/**
 * The ID of the message or tool call that an output update belongs to. A `session/load` repeats it.
 * A message with no text yet has none: OpenCode 2.2.0 stores the message when it starts and its text
 * when the step ends, so a replay between the two shows it empty.
 */
function shownEntryId(update: SessionUpdate): string | null {
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") return update.toolCallId;
  if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk")
    return update.content.type === "text" && update.content.text ? contentMessageId(update) : null;
  return null;
}

/** The whole text of one message in a replay. */
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

/** A tool call that ended and left a background task running (OpenCode 2.2.0 `subagent`). */
function startsBackgroundTask(rawOutput: unknown): boolean {
  const metadata = getRecord(rawOutput, "metadata");
  return metadata?.status === "running" && isString(metadata.sessionID);
}

/** A missing session, identified by the agent's flavor or by the protocol's `-32002` error. */
function isSessionNotFound(error: unknown, sessionId: string, flavor: AcpFlavor): boolean {
  if (!(error instanceof RequestError)) return false;
  const flavored = flavor.sessionNotFound?.(error, sessionId) ?? null;
  if (flavored !== null) return flavored;
  if (error.code !== -32002) return false;
  const uri = isRecord(error.data) ? error.data.uri : undefined;
  return uri === sessionId || error.message.includes(sessionId);
}

/**
 * The agent's explanation of a protocol error, which `String(error)` leaves out. When a handler in
 * an ACP agent throws, the SDK puts the thrown message in `data.details` (#1193). Grok sends a string
 * `data`, such as "session/resume does not support additionalDirectories" (#1729), or `data.detail`.
 * Grok 1.0.67 moves that string to `data.message` when it adds the turn's usage or an HTTP status (#2980).
 */
function failureDetail(error: RequestError): string | null {
  const data = error.data;
  const detail =
    typeof data === "string" ? data : isRecord(data) ? (data.details ?? data.detail ?? data.message) : undefined;
  return typeof detail === "string" && detail ? detail : null;
}

/** The text of a failed request, with the agent's explanation. */
function failureText(error: unknown): string {
  if (!(error instanceof RequestError)) return String(error);
  const detail = failureDetail(error);
  return detail && !error.message.includes(detail) ? `${String(error)}: ${detail}` : String(error);
}

/**
 * A message chunk that is the harness's own complete error report: "API Error: Connection lost
 * mid-response. The response above may be incomplete." Only the full report matches, so answer text
 * that starts with "API Error: " stays in the answer.
 */
const HARNESS_ERROR_CHUNK = /^\s*API Error: [^\n]*The response above may be incomplete\.\s*$/u;

function isAuthenticationError(error: unknown): boolean {
  return /auth|login|credential|token|unauthori[sz]ed|api key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
