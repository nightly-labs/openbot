import { type ChildProcess, spawn } from "node:child_process";
import { basename } from "node:path";
import type {
  AccountUsage,
  AgentEvent,
  AgentModelId,
  AgentModelOption,
  AgentProviderStatus,
  AgentStatus,
  AgentSummary,
  CapabilityState,
  CustomProviderRestart,
  ProviderCodeLoginStart,
} from "@openbot/contracts/ipc";
import {
  accountUsageCoversModel,
  agentProviderDescriptor,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import { startAcpAuthentication } from "./../acp-sign-in";
import { type AgentClient, AgentProcessExitError, type AgentProvider, RequestTimeoutError } from "./../agent-client";
import { CodexAppServerClient } from "./../app-server-client";
import { type AgentCliInfo, type BundledProviderExecutables, CodexCliError } from "./../cli";
import { McpHandoffLog } from "./../mcp-handoff-log";
import { openCodeSignInMessage } from "./../opencode-config";
import { readOpenCodeGoUsage } from "./../opencode-usage";
import type { ProcessConfinement } from "../process-confinement";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  getString,
  type ModelListResponse,
} from "./../protocol";
import type { ProviderClientOperationError } from "../provider-client-effects";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  type ProviderClientContext,
  requireProviderDriver,
  savedCustomAgents,
} from "./../provider-drivers";
import { recordRestartActivity } from "../restart-activity";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { stopProcessTree } from "../windows-process-tree";
import { TimeoutError } from "../with-timeout";
import { normalizeAccountUsage } from "./account-usage";
import { type CliCodeLogin, type CliCodeLoginFailed, startCliCodeLogin } from "./cli-code-login";
import { CodexLoginFailed, CodexLoginFlow } from "./codex-login";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  createAcpRequestEchoReader,
  ignoredCodexSettings,
  isAcpHandlerDiagnostic,
  isBackgroundRefreshDiagnostic,
  isGlogBelowErrorDiagnostic,
  isIgnoredConfigDiagnostic,
  isMcpSubsystemDiagnostic,
  isTelemetryExportDiagnostic,
  isToolCallDiagnostic,
  isUsageLimitDiagnostic,
  LOG_TIMESTAMP_PREFIX,
} from "./provider-diagnostics";
import {
  claudeModelName,
  compareModelVersions,
  FALLBACK_MODELS,
  isOpencodeModelUnusableWithStoredKey,
  modelDisplayName,
  modelsAfterOpenCodeDiscoveryFailure,
  OPENCODE_FREE_MODEL_FALLBACKS,
  PREFERRED_MODEL_ORDER,
} from "./provider-models";
import {
  type ProviderProcessFailed,
  providerFailureStatus,
  setProviderStatus,
  updateProviderStatus,
  waitForSuccessfulProcess,
} from "./provider-status";
import { providerForAgent, providerLabel } from "./thread-items";
import { workspaceWritableRoots } from "./workspace-sandbox";

const logger = createOpenBotLogger("provider-runtime");
/**
 * Stderr records that the classifiers sort out as noise. They can quote a tool call's output or a
 * command line, so they go to the console only and not to the provider log file.
 */
const stderrLogger = createOpenBotLogger("provider-stderr");

const ACCOUNT_USAGE_READ_TIMEOUT_MS = 30_000;
/**
 * How long the first start of a CLI that was just installed may take. The Gemini runtime unpacks
 * itself on its first run, and an antivirus scan of the unpacked files can take minutes on a slow
 * computer. The request timeout failed that start after a good download, the install was rolled
 * back, and each retry downloaded and failed again. Only this start waits so long: a launch waits
 * for every provider, and one CLI that hangs would hold chat back for all of them.
 */
const INSTALLED_CLI_START_TIMEOUT_MS = 180_000;
/** How long a provider CLI stays running with nothing to do before its process is stopped. */
export const PROVIDER_IDLE_RELEASE_MS = 10 * 60_000;
/**
 * The same for a provider no agent is set to. Every signed-in provider starts at launch to read its
 * models, and an unused OpenCode process alone held about 300 MB for the full idle time.
 */
export const PROVIDER_UNASSIGNED_RELEASE_MS = 60_000;
const PROVIDER_IDLE_CHECK_MS = 60_000;
/** How often a restart the user asked for checks whether the provider's turns have ended. */
const PROVIDER_RESTART_POLL_MS = 1_000;
const MODEL_METADATA_FALLBACKS = [...FALLBACK_MODELS, ...OPENCODE_FREE_MODEL_FALLBACKS];
/**
 * The providers whose shared process reads the agent environment only when it starts. Claude reads
 * it at each session start, and Codex with each thread's config.
 */
const SPAWN_ENVIRONMENT_PROVIDERS: readonly AgentProvider[] = [
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "acp",
];

/** The CLI did not answer in time: its `--version`, or a request of its start, such as `initialize`. */
function isProviderTimeout(error: unknown): boolean {
  return (
    (error instanceof CodexCliError && error.code === "timeout") ||
    error instanceof TimeoutError ||
    error instanceof RequestTimeoutError
  );
}

/** One log line for each row whose state changes, so the provider log shows when a provider went away. */
function logProviderStateChanges(
  previous: readonly AgentProviderStatus[],
  next: readonly AgentProviderStatus[],
  redactMcp: (text: string) => string,
): void {
  for (const row of next) {
    const before = previous.find((candidate) => candidate.id === row.id);
    if (before?.state === row.state) continue;
    logger.info("A provider changed state.", {
      provider: row.id,
      from: before?.state ?? null,
      to: row.state,
      version: row.version,
      message: row.message === null ? null : shortenDiagnostic(redactMcp(row.message)),
    });
  }
}

/**
 * True once a window of a kept reading has passed its reset time, so the reading is stale. Only
 * then does a usage read start a released provider again. `resetsAt` is in seconds.
 */
function usageWindowHasReset(limit: AccountUsage["limits"][number]): boolean {
  const now = Date.now() / 1_000;
  return [limit.primary, limit.secondary].some((window) => window?.resetsAt != null && window.resetsAt <= now);
}

/** A sign-in that is a CLI process the user completes in a browser the CLI opened, or on another device. */
interface PendingCliLogin {
  child: ChildProcess;
  cli: AgentCliInfo;
  task: Fiber.Fiber<void, ProviderOperationFailed> | null;
  scope: Scope.Closeable;
  /** A code sign-in: what the CLI printed for the user, and the prompt a pasted code goes to. */
  code?: Pick<CliCodeLogin, "prompt" | "submit">;
}

export type AgentClientFactory = (
  provider: AgentProvider,
  cli: AgentCliInfo,
  confinement?: ProcessConfinement,
) => AgentClient;

/**
 * The own process of one Workspace only agent on a provider that confines a whole process. `key`
 * names what the process was started with, so a changed workspace, CLI or provider process
 * starts a new one before the next turn.
 */
interface ConfinedClient {
  readonly client: AgentClient;
  readonly key: string;
  lastUsed: number;
}

/** What the provider domain needs from the rest of the service. Four calls, no state. */
export interface ProviderHooks {
  /** Wires the notification and server-request routers, which stay in the core. */
  bindClient(client: AgentClient): void;
  /**
   * Runs after a connect or an activation leaves at least one client ready. Collapses the tail
   * that #connect and #activateProviderClient each carried a copy of.
   */
  onProvidersReady(): Effect.Effect<void, ProviderOperationFailed>;
  /** The cleanup #handleExit used to inline: prompts, approvals, takeovers, compaction, browser. */
  onProviderLost(client: AgentClient): void;
  /**
   * Runs when the runtime stops a client it used for a reason other than an exit: an idle release,
   * a sign-out that an account refresh found, or a new client for the same provider. `#handleExit`
   * skips such a client, and it can never answer its pending prompts, approvals and browser
   * takeovers, or complete the turns it ran. It runs after the stop, so a request the process sent
   * while it stopped is cleared too.
   */
  onClientStopped(client: AgentClient): Effect.Effect<void>;
  /** True once stop() has begun, so a client exiting during shutdown does not trigger a restart. */
  isStopping(): boolean;
  /** True while a turn on this provider runs or starts, which replacing its CLI would cut short. */
  isProviderBusy(provider: AgentProvider): boolean;
  /** True while a turn of this agent runs. An agent's own process stays while its own turn runs. */
  isAgentBusy(agentId: string): boolean;
  /** True while an agent is set to this provider, so a turn on it can come at any time. */
  isProviderAssigned(provider: AgentProvider): boolean;
  /**
   * Runs when the own process of a Workspace only agent exits by itself. The provider's shared
   * process still runs, so nothing restarts: the next turn of this agent starts a new process.
   */
  onAgentClientLost(agentId: string, client: AgentClient): Effect.Effect<void>;
  /** The shared folder, which every Workspace only agent may write besides its workspace. */
  sharedRoot(): string;
  /** Runs after a CLI replacement, so deliveries held back during it are delivered. */
  onProviderResumed(provider: AgentProvider): void;
  /**
   * Runs once a new client for this provider is the one the app uses, with the catalogue it reported
   * already read. A client that failed to start, or one dropped for a client that was there before,
   * never reaches this: what the caller hears is that the process now answering read the files as
   * they were at `configRevision`, which is what `captureConfigRevision` answered when it spawned.
   */
  onProviderActivated(provider: AgentProvider, configRevision: number): Effect.Effect<void, ProviderOperationFailed>;
  /**
   * The configuration a process spawning now reads. A CLI reads the endpoint files once, at spawn,
   * so a change made while it starts is not in the process that arrives.
   */
  captureConfigRevision(): number;
}

/**
 * The read-only view other domains get. #status is read outside the provider domain in five
 * places and every one of them asks the same question, so they get a boolean rather than the
 * status object.
 */
export interface ProviderPort {
  isReady(): boolean;
  clientFor(provider: AgentProvider): AgentClient | null;
  clientForAgent(agent: AgentSummary): AgentClient | null;
  listModels(): AgentModelOption[];
}

const INITIAL_STATUS: AgentStatus = {
  phase: "idle",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: [
    { id: "codex", state: "not-started", version: null, message: null },
    { id: "claude", state: "not-started", version: null, message: null },
    { id: "grok", state: "not-started", version: null, message: null },
    { id: "opencode", state: "not-started", version: null, message: null },
    { id: "antigravity", state: "not-started", version: null, message: null },
    { id: "cursor", state: "not-started", version: null, message: null },
    { id: "cline", state: "not-started", version: null, message: null },
    { id: "acp", state: "not-started", version: null, message: null },
  ],
  capabilities: {
    chat: "unavailable",
    browser: "ready",
    computerUse: "unavailable",
  },
  message: null,
  fullAccess: true,
};

/**
 * Owns provider processes, their CLIs, accounts, login flows and the derived AgentStatus.
 *
 * Everything here is keyed by AgentProvider and nothing else is. The class exists because
 * #status was read in five places outside this domain and written in sixteen inside it; the
 * ProviderPort above is what those five places get now.
 */
export class ProviderRuntime implements ProviderPort {
  readonly #conversation: ConversationRuntime;
  readonly #hooks: ProviderHooks;
  readonly #emit: (event: AgentEvent) => void;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #requestTimeoutMs: number;
  readonly #clientFactory: AgentClientFactory | null;
  readonly #bundledExecutables: BundledProviderExecutables;
  readonly #credentials: ProviderClientContext;
  readonly #clients = new Map<AgentProvider, AgentClient>();
  /** By agent id. See `ConfinedClient`. */
  readonly #confined = new Map<string, ConfinedClient>();
  readonly #confinedStarts = new Map<string, Deferred.Deferred<AgentClient, ProviderOperationFailed>>();
  /**
   * Counts the shared clients that replaced another one for a reason other than an idle release: a
   * new CLI, a stored key, the endpoints or the MCP servers. An agent's own process that started
   * before the count changed read the old values, so its next turn starts it again.
   */
  readonly #activations = new Map<AgentProvider, number>();
  readonly #usageLimitRefreshes = new WeakSet<AgentClient>();
  /**
   * What this app has already handed to a provider process.
   *
   * A process keeps the configuration it spawned with until it stops, and the user can edit a
   * credential or disable a server while a turn runs - `applyPendingRuntimeRefresh` waits for that
   * turn on purpose. Reading only the current configuration when a diagnostic arrives would
   * therefore miss the value the process is quoting.
   */
  readonly #mcpHandoff: McpHandoffLog;
  /**
   * One piece of provider text with the MCP credentials taken out of it.
   *
   * Owned by the service, not by this class, because only the store holds every credential the user
   * wrote: the source this class reads carries the enabled servers alone. Every provider message
   * that becomes a status message, a log line or a renderer event passes through here, because a
   * CLI reports a failure by quoting what it sent.
   */
  readonly #redactMcp: (text: string) => string;
  /** What each client's process read when it spawned, which decides what its catalogue may confirm. */
  readonly #configRevisions = new WeakMap<AgentClient, number>();
  readonly #cli = new Map<AgentProvider, AgentCliInfo>();
  /**
   * Who owns each provider's binary, as the last resolution found it.
   *
   * `#cli` holds only the CLI a client runs on, and a provider that is signed out has no client
   * although its binary is resolved and its version is on the row. Without this record that row
   * names no owner, and an unowned CLI is read as the managed copy: the user's own install would be
   * offered a download instead of its own updater.
   */
  readonly #cliSources = new Map<AgentProvider, AgentCliInfo["source"]>();
  readonly #accounts = new Map<AgentProvider, AccountReadResult["account"]>();
  readonly #providerStarts = new Map<AgentProvider, Deferred.Deferred<void, ProviderOperationFailed>>();
  readonly #providerConnectionCommands = new Map<AgentProvider, Deferred.Deferred<void, ProviderOperationFailed>>();
  readonly #replacingCli = new Set<AgentProvider>();
  /**
   * Providers whose idle process was stopped to give its memory back. Each one keeps its status,
   * account and models, so every view reads it as connected; `ensureProvider` starts it again.
   */
  readonly #released = new Set<AgentProvider>();
  /**
   * Restarts the user asked for, which wait for the provider's turns to end. The provider is held as
   * `isReplacingCli` meanwhile, so no new turn starts on the process that is about to stop. The value
   * is the next check, or `null` while the restart runs and can no longer be cancelled.
   */
  readonly #restartsWhenIdle = new Map<AgentProvider, NodeJS.Timeout | null>();
  /** A custom agent change that a turn delayed. The idle check applies it when the turn stops. */
  #customAgentsReloadPending = false;
  /** Providers that a turn kept on the old agent environment. The idle check restarts each after its turn. */
  readonly #environmentReloadPending = new Set<AgentProvider>();
  readonly #lastUsed = new Map<AgentProvider, number>();
  /**
   * The last failure of each provider: a start, an exit, a model list or a diagnostic shown to the
   * user. The provider row keeps it after the toast is gone, until a model list that started after
   * it succeeds. `serial` orders it against that list.
   */
  readonly #lastErrors = new Map<AgentProvider, { message: string; at: number; serial: number }>();
  #errorSerial = 0;
  /** The last usage each provider reported, shown for a released provider instead of starting it. */
  readonly #lastUsage = new Map<AgentProvider, AccountUsage["limits"][number]>();
  /**
   * Providers whose last usage read returned no limit, such as custom ACP agents. The dock polls
   * every five minutes, so starting a released one to ask again would keep its process running.
   */
  readonly #usageUnreported = new Set<AgentProvider>();
  #idleCheck: NodeJS.Timeout | null = null;
  #status: AgentStatus = structuredClone(INITIAL_STATUS);
  #providerRefresh: Deferred.Deferred<AgentStatus, ProviderOperationFailed> | null = null;
  readonly #codexLogin: CodexLoginFlow;
  readonly #cliLogins = new Map<AgentProvider, PendingCliLogin>();
  #providerActivation = Semaphore.makeUnsafe(1);
  #scope = Scope.makeUnsafe();
  #preferredProvider: AgentProvider;
  /**
   * The model setup chose beside the preferred provider, or `null` for that provider's own default.
   * It is a preference, not a promise: the provider lists its own models, so a model that is gone
   * is ignored by the callers that read it.
   */
  #preferredModel: AgentModelId | null;
  /** Per provider: one provider that exits must not delay, or take the retries of, another. */
  readonly #restartAttempts = new Map<AgentProvider, number>();
  readonly #restartTimers = new Map<AgentProvider, NodeJS.Timeout>();
  /**
   * Providers whose client exited and whose deliveries `onProviderLost` left for restart recovery.
   * Their next connect runs `onProvidersReady`, also when it is a retry after a timeout.
   */
  readonly #exitRecovery = new Set<AgentProvider>();
  /**
   * Ignored-settings warnings already shown. Codex repeats one at each start, and a reconnect does
   * not change the file it reads, so the user sees each one once per app run.
   */
  readonly #reportedConfigWarnings = new Set<string>();
  /** Counts `dispose()` calls, so a start from before one cannot add its client after it. */
  #disposals = 0;
  #models = structuredClone(FALLBACK_MODELS);

  constructor(options: {
    conversation: ConversationRuntime;
    hooks: ProviderHooks;
    emit: (event: AgentEvent) => void;
    emitError: (code: string, error: unknown, agentId?: string) => void;
    requestTimeoutMs: number;
    preferredProvider: AgentProvider;
    preferredModel?: AgentModelId | null;
    clientFactory: AgentClientFactory | null;
    bundledExecutables: BundledProviderExecutables;
    credentials: ProviderClientContext;
    mcpHandoff?: McpHandoffLog;
    redactMcp: (text: string) => string;
  }) {
    this.#conversation = options.conversation;
    this.#hooks = options.hooks;
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#preferredProvider = options.preferredProvider;
    this.#preferredModel = options.preferredModel ?? null;
    this.#clientFactory = options.clientFactory;
    this.#bundledExecutables = { ...options.bundledExecutables };
    this.#credentials = options.credentials;
    this.#mcpHandoff = options.mcpHandoff ?? new McpHandoffLog();
    this.#redactMcp = options.redactMcp;
    this.#codexLogin = new CodexLoginFlow({
      bundledExecutable: () => this.#bundledExecutables.codex,
      createClient: (cli) => {
        const client = this.#clientFactory
          ? this.#clientFactory("codex", cli)
          : new CodexAppServerClient(cli.executable, this.#requestTimeoutMs);
        this.#bindClient(client);
        return client;
      },
      hasActiveClient: (client) => (client ? this.#clients.get("codex") === client : this.#clients.has("codex")),
      activate: (client, cli, account, activateOptions) =>
        this.#activateProviderClient("codex", client, cli, account, activateOptions).pipe(
          Effect.mapError((failure) => new CodexLoginFailed({ cause: failure.cause })),
        ),
      setConnecting: () => this.#setProviderConnectionState("codex", "connecting"),
      isConnecting: () =>
        this.#status.providers?.find((provider) => provider.id === "codex")?.connectionState === "connecting",
      clearConnectionState: () => this.#clearProviderConnectionState("codex"),
      setFailure: (error, version) => this.#setProviderConnectionFailure("codex", error, version),
    });
  }

  /**
   * Every read of the status names who owns each CLI, from the resolved binary rather than from a
   * stored field, so a provider that switches between the user's install and the managed copy
   * cannot leave a stale owner behind. It is added here, not in `#setStatus`, because both the
   * getter and the events `#setStatus` emits go through it.
   */
  status(): AgentStatus {
    const status = structuredClone(this.#status);
    if (!status.providers) return status;
    return {
      ...status,
      providers: status.providers.map((row) => {
        const source = this.#cli.get(row.id)?.source ?? this.#cliSources.get(row.id);
        const lastError = this.#lastErrors.get(row.id);
        const withSource = {
          ...row,
          ...(source ? { cliSource: source } : {}),
          ...(lastError ? { lastError: lastError.message, lastErrorAt: lastError.at } : {}),
        };
        return this.#restartsWhenIdle.has(row.id) ? { ...withSource, restartPending: true } : withSource;
      }),
    };
  }

  /** The failure the provider row shows, or null after a good model list. */
  lastError(provider: AgentProvider): string | null {
    return this.#lastErrors.get(provider)?.message ?? null;
  }

  /** Resolve a provider's binary and keep who owns it, whether or not the provider is signed in. */
  readonly #resolveProviderCli = Effect.fn("ProviderRuntime.resolveCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    return yield* Effect.gen({ self: this }, function* () {
      if (provider === "acp" && savedCustomAgents(this.#credentials).length === 0) {
        return yield* new ProviderOperationFailed({
          cause: new CodexCliError(sourceText("error.provider.customAgentNone"), "missing"),
        });
      }
      const cli = yield* requireProviderDriver(provider)
        .resolveCli({
          bundledExecutable: this.#bundledExecutables[provider],
        })
        .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
      this.#cliSources.set(provider, cli.source);
      return cli;
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          this.#cliSources.delete(provider);
        }),
      ),
    );
  });

  isReady(): boolean {
    return this.#status.phase === "ready";
  }

  /**
   * Provider operations in flight right now: CLI logins and replacements, connection checks,
   * provider starts, and the pending Codex login. Long-lived provider clients are deliberately
   * not counted: they are stopped by the normal shutdown, and a client mid-turn always carries
   * an active turn id, which the activity check sees. MCP servers a provider CLI spawned inside
   * its own session stay invisible here; a live turn implies them.
   */
  activeProcessCount(): number {
    return (
      this.#cliLogins.size +
      this.#providerStarts.size +
      this.#providerConnectionCommands.size +
      this.#replacingCli.size +
      this.#restartsWhenIdle.size +
      (this.#codexLogin.pending ? 1 : 0)
    );
  }

  clientFor(provider: AgentProvider): AgentClient | null {
    const client = this.#clients.get(provider) ?? null;
    if (client) this.#lastUsed.set(provider, Date.now());
    return client;
  }

  /**
   * Stops each provider process that ran no turn for `PROVIDER_IDLE_RELEASE_MS`, or for
   * `PROVIDER_UNASSIGNED_RELEASE_MS` when no agent is set to it. An idle CLI holds
   * hundreds of megabytes, and every signed-in provider starts at launch whether an agent uses it
   * or not. Its threads are unloaded, so the next turn resumes them on the process that replaces it.
   */

  readonly #releaseIdleProviders = Effect.fn("ProviderRuntime.releaseIdleProviders")(function* (this: ProviderRuntime) {
    if (this.#hooks.isStopping() || this.#status.phase !== "ready") return;
    if (this.#customAgentsReloadPending && !this.#hooks.isProviderBusy("acp")) yield* this.reloadCustomAgents();
    for (const provider of this.#environmentReloadPending) {
      if (!this.#hooks.isProviderBusy(provider)) yield* this.#reloadAgentEnvironment(provider);
    }
    const now = Date.now();
    for (const [provider, client] of this.#clients) {
      if (
        this.#hooks.isProviderBusy(provider) ||
        this.#providerStarts.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        this.#replacingCli.has(provider) ||
        this.#restartsWhenIdle.has(provider) ||
        this.#cliLogins.has(provider) ||
        (provider === "codex" && this.#codexLogin.pending)
      ) {
        this.#lastUsed.set(provider, now);
        continue;
      }
      const lastUsed = this.#lastUsed.get(provider);
      if (lastUsed === undefined) {
        this.#lastUsed.set(provider, now);
        continue;
      }
      const limit = this.#hooks.isProviderAssigned(provider)
        ? PROVIDER_IDLE_RELEASE_MS
        : PROVIDER_UNASSIGNED_RELEASE_MS;
      if (now - lastUsed < limit) continue;
      // Out of the map before it stops, so #handleExit reads the exit as expected, not as a crash.
      this.#clients.delete(provider);
      this.#released.add(provider);
      this.#conversation.unloadClientThreads(client);
      logger.info("Stopped an idle provider CLI.", { provider });
      yield* client
        .stop()
        .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })))
        .pipe(Effect.ignore);
      yield* this.#hooks.onClientStopped(client);
    }
    for (const [agentId, confined] of this.#confined) {
      if (this.#hooks.isAgentBusy(agentId)) confined.lastUsed = now;
      if (now - confined.lastUsed < PROVIDER_IDLE_RELEASE_MS) continue;
      logger.info("Stopped an idle Workspace only provider process.", { provider: confined.client.provider, agentId });
      yield* this.#stopConfined(agentId, confined);
    }
  }, Effect.uninterruptible);

  /** Closes the idle threads of each client and each Workspace only process, when memory is low. */
  readonly releaseIdleThreads = Effect.fn("ProviderRuntime.releaseIdleThreads")(function* (this: ProviderRuntime) {
    for (const client of this.#clients.values()) if (client.releaseIdleThreads) yield* client.releaseIdleThreads();
    for (const { client } of this.#confined.values()) if (client.releaseIdleThreads) yield* client.releaseIdleThreads();
  }).bind(this);

  listModels(): AgentModelOption[] {
    return structuredClone(this.#models);
  }

  createProfileClient(provider: AgentProvider): AgentClient {
    const cli = this.#cli.get(provider);
    if (!cli || !this.#clients.has(provider)) throw new Error(sourceText("error.provider.connectBeforeProfile"));
    if (this.#clientFactory) return this.#clientFactory(provider, cli);
    const driver = requireProviderDriver(provider);
    if (driver.createProfileClient) return driver.createProfileClient(cli, this.#requestTimeoutMs, this.#credentials);
    return driver.createClient(cli, this.#requestTimeoutMs, this.#credentials);
  }

  preferredProvider(): AgentProvider {
    return this.#preferredProvider;
  }

  preferredModel(): AgentModelId | null {
    return this.#preferredModel;
  }

  /**
   * Without a scope this is the account-wide reading the dock polls: one limit per connected
   * provider that can report usage, then a broadcast. Scoped to one agent it answers for that
   * agent's own model and stays quiet, so it must not overwrite the list every other view shows.
   */

  readonly usage = Effect.fn("ProviderRuntime.usage")(function* (
    this: ProviderRuntime,
    scope?: { provider: AgentProvider; model: string },
  ) {
    const deadline = Effect.timeoutOrElse({
      duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
      orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
    });
    if (!scope) {
      const available = (this.status().providers ?? []).filter(
        (item) => isAgentProvider(item.id) && item.state === "available" && item.connectionState !== "connecting",
      );
      const providers = available
        .map((item) => item.id)
        .filter(isAgentProvider)
        .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder);
      const collected = new Map<AgentProvider, AccountUsage["limits"][number]>();
      yield* Effect.forEach(
        providers,
        (provider) =>
          Effect.gen({ self: this }, function* () {
            let usage: AccountUsage;
            if (provider === "opencode") {
              // The Go quota is one HTTPS request with the saved key, so do not start OpenCode for it.
              usage = normalizeAccountUsage(
                yield* readOpenCodeGoUsage(this.#credentials.apiKey("opencode")).pipe(
                  Effect.mapError((error) => new ProviderOperationFailed({ cause: error.cause })),
                  deadline,
                ),
              );
            } else {
              const kept = this.#released.has(provider) ? this.#lastUsage.get(provider) : undefined;
              if (kept && !usageWindowHasReset(kept)) {
                collected.set(provider, kept);
                this.#emit({ type: "usage-changed", usage: { limits: [...collected.values()] } });
                return;
              }
              if (this.#released.has(provider) && this.#usageUnreported.has(provider)) return;
              if (!this.#clients.has(provider)) yield* this.ensureProvider(provider);
              const client = this.#clients.get(provider);
              if (!client) return;
              const model =
                provider === "codex" ? undefined : agentProviderDescriptor(provider).defaultModel || undefined;
              usage = yield* this.#refreshUsage(client, model, false).pipe(deadline);
            }
            const limit = usage.limits[0];
            if (!limit || (!limit.primary && !limit.secondary)) {
              this.#usageUnreported.add(provider);
              return;
            }
            this.#usageUnreported.delete(provider);
            collected.set(provider, { ...limit, id: provider });
            this.#lastUsage.set(provider, { ...limit, id: provider });
            this.#emit({
              type: "usage-changed",
              usage: { limits: [...collected.values()] },
            });
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                logger.warn("Could not read provider usage.", {
                  provider,
                  message: error.cause instanceof Error ? this.#redactMcp(error.cause.message) : "unknown",
                });
              }),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      );
      return { limits: structuredClone([...collected.values()]) };
    }
    const client = this.#clients.get(scope.provider);
    if (!client || !accountUsageCoversModel(scope.provider, scope.model)) return { limits: [] };
    return yield* this.#refreshUsage(client, scope.model, false);
  }).bind(this);

  readonly start = Effect.fn("ProviderRuntime.start")(function* (this: ProviderRuntime) {
    if (this.#scope.state._tag === "Closed") this.#scope = Scope.makeUnsafe();
    this.#idleCheck ??= setInterval(
      () => Effect.runFork(this.#releaseIdleProviders().pipe(Effect.forkIn(this.#scope))),
      PROVIDER_IDLE_CHECK_MS,
    );
    this.#idleCheck.unref?.();
    yield* this.#connect(
      "starting",
      BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id),
    );
  }).bind(this);

  readonly setPreferredProvider = Effect.fn("ProviderRuntime.setPreferredProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    initialized: boolean,
    model: AgentModelId | null,
  ) {
    this.#preferredProvider = provider;
    // The two travel together: a provider chosen without a model means that provider's default, so
    // the model of an earlier choice must not survive the new one.
    this.#preferredModel = model;
    if (!initialized) return;
    yield* this.ensureProvider(provider).pipe(Effect.ignore);
    const account = this.#accounts.get(provider);
    if (!this.#clients.has(provider) || !account) return;
    this.#setStatus({
      cliVersion: this.#cli.get(provider)?.version ?? null,
      auth: requireProviderDriver(provider).authState(account),
    });
  }).bind(this);

  readonly ensureProvider = Effect.fn("ProviderRuntime.ensureProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    this.#lastUsed.set(provider, Date.now());
    if (this.#clients.has(provider)) return;
    const wake = this.#released.has(provider);
    yield* this.#startProvider(provider, wake ? { notifyReady: false } : {});
    if (this.#clients.has(provider)) return;
    const status = this.#status.providers?.find((candidate) => candidate.id === provider);
    return yield* new ProviderOperationFailed({
      cause: new Error(
        status?.message ?? sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) }),
      ),
    });
  }).bind(this);

  readonly refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (this: ProviderRuntime) {
    if (this.#providerRefresh) return yield* Deferred.await(this.#providerRefresh);
    if (this.#status.phase === "starting" || this.#status.phase === "restarting") return this.status();
    const completion = Deferred.makeUnsafe<AgentStatus, ProviderOperationFailed>();
    this.#providerRefresh = completion;
    const exit = yield* Effect.exit(this.#refreshProviders());
    yield* Deferred.done(completion, exit);
    if (this.#providerRefresh === completion) this.#providerRefresh = null;
    return yield* exit;
  }, Effect.uninterruptible).bind(this);

  readonly refreshProvider = Effect.fn("ProviderRuntime.refreshProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    if (this.#clients.has(provider)) return this.status();
    this.#resetRestarts(provider);
    yield* this.#startProvider(provider, { preserveCheckErrors: true, refreshRuntimeInBackground: true });
    return this.status();
  }).bind(this);

  readonly #startProvider = Effect.fn("ProviderRuntime.startProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    options: { notifyReady?: boolean; preserveCheckErrors?: boolean; refreshRuntimeInBackground?: boolean },
    phase: "starting" | "restarting" = "starting",
  ) {
    const pending = this.#providerStarts.get(provider);
    if (pending) return yield* Deferred.await(pending);
    const completion = Deferred.makeUnsafe<void, ProviderOperationFailed>();
    this.#providerStarts.set(provider, completion);
    recordRestartActivity();
    const exit = yield* Effect.exit(this.#connect(phase, [provider], options));
    yield* Deferred.done(completion, exit);
    if (this.#providerStarts.get(provider) === completion) this.#providerStarts.delete(provider);
    return yield* exit;
  }, Effect.uninterruptible);

  /**
   * Signs the user in to one provider, in the way that provider's driver declares. `openExternal`
   * is only reached by a `browser` sign-in, whose login hands back a URL; a `cli-command` sign-in
   * opens its own browser window from the CLI OpenBot spawns, and an `external` sign-in happens
   * outside OpenBot, so Connect only asks the provider again.
   */
  readonly connectProvider = Effect.fn("ProviderRuntime.connectProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
  ) {
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    if (start && this.#clients.has(provider) && this.#accounts.has(provider)) return this.status();
    if (this.#providerRefresh || (!start && ["starting", "restarting"].includes(this.#status.phase))) {
      return this.status();
    }
    const signIn = requireProviderDriver(provider).signIn;
    return yield* this.#runProviderConnectionCommand(provider, () => this.#signIn(provider, signIn, openExternal));
  }).bind(this);

  readonly #signIn = Effect.fn("ProviderRuntime.signIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    signIn: ReturnType<typeof requireProviderDriver>["signIn"],
    openExternal: (url: string) => Promise<void>,
  ) {
    switch (signIn.kind) {
      case "browser":
        yield* this.#codexLogin.cancel(null);
        yield* this.#codexLogin
          .startBrowser(openExternal)
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
        return this.status();
      case "cli-command":
        yield* this.#cancelCliLogin(provider, null);
        return yield* this.#startCliLogin(provider, (cli) =>
          Effect.gen(function* () {
            const child = yield* Effect.acquireRelease(
              providerStep(() =>
                spawn(cli.executable, [...signIn.command.argv], {
                  cwd: process.cwd(),
                  env: { ...process.env, ...signIn.command.env(cli) },
                  stdio: "ignore",
                  shell: false,
                  windowsHide: process.platform === "win32",
                }),
              ),
              (child) => stopProcessTree(child).pipe(Effect.orDie),
            );
            return { child, done: waitForSuccessfulProcess(child, signIn.command.timeoutMs) };
          }),
        ).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
      case "acp-authenticate":
        yield* this.#cancelCliLogin(provider, null);
        return yield* this.#startCliLogin(provider, (cli) =>
          startAcpAuthentication({
            executable: cli.executable,
            argv: signIn.argv,
            env: { ...signIn.env },
            methodId: signIn.methodId,
            timeoutMs: signIn.timeoutMs,
          }),
        ).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
      case "external":
        return yield* this.#reprobeProvider(provider);
    }
  });

  /**
   * Starts a sign-in the user finishes on another device, for a provider that offers one.
   *
   * Runs in the same queue as Connect, and cancels a sign-in already waiting: two live codes for
   * one provider would leave the user reading the dead one. An account already on this computer is
   * not a reason to refuse: asking for a code while signed in is how the user reaches a different
   * account, and the one in use keeps working until the new sign-in finishes.
   */
  readonly startProviderCodeLogin = Effect.fn("ProviderRuntime.startProviderCodeLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const codeSignIn = requireProviderDriver(provider).codeSignIn;
    if (!codeSignIn) {
      throw new Error(sourceText("error.provider.noCodeSignIn", { provider: providerLabel(provider) }));
    }
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    return yield* this.#runProviderConnectionCommand(provider, () => this.#startProviderCode(provider, codeSignIn));
  }).bind(this);

  readonly #startProviderCode = Effect.fn("ProviderRuntime.startCodeLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    codeSignIn: NonNullable<ReturnType<typeof requireProviderDriver>["codeSignIn"]>,
  ): Effect.fn.Return<ProviderCodeLoginStart, ProviderOperationFailed> {
    if (codeSignIn.kind === "codex-device") {
      yield* this.#codexLogin.cancel(null);
      return yield* this.#codexLogin
        .startDevice()
        .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
    }
    yield* this.#cancelCliLogin(provider, null);
    const { command, flow } = codeSignIn;
    yield* this.#startCliLogin(provider, (cli) =>
      startCliCodeLogin({
        flow,
        executable: cli.executable,
        argv: command.argv,
        env: command.env(cli),
        timeoutMs: command.timeoutMs,
      }),
    );
    const code = this.#cliLogins.get(provider)?.code;
    if (!code)
      return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) });
    const expiresAt = Date.now() + command.timeoutMs;
    const prompt = yield* code.prompt.pipe(
      Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
    );
    return prompt.flow === "paste"
      ? { kind: "paste", verificationUrl: prompt.verificationUrl, expiresAt }
      : {
          kind: "code",
          userCode: prompt.userCode,
          verificationUrl: prompt.verificationUrl,
          ...(prompt.verificationUrlComplete ? { verificationUrlComplete: prompt.verificationUrlComplete } : {}),
          expiresAt,
        };
  }, Effect.uninterruptible);

  /**
   * Types the code the provider's page showed into the CLI that is waiting for it. The code is a
   * credential: it goes to the CLI's stdin and nowhere else. How the sign-in ends arrives as the
   * provider's status.
   */
  submitProviderCodeLogin(provider: AgentProvider, code: string): AgentStatus {
    const pending = this.#cliLogins.get(provider);
    if (!pending?.code) throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
    pending.code.submit(code);
    return this.status();
  }

  /** Abandons a code sign-in. The provider is told, so the code cannot be used after this returns. */
  readonly cancelProviderCodeLogin = Effect.fn("ProviderRuntime.cancelCodeLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const codeSignIn = requireProviderDriver(provider).codeSignIn;
    if (!codeSignIn) return this.status();
    return yield* this.#runProviderConnectionCommand(provider, () =>
      Effect.gen({ self: this }, function* () {
        if (codeSignIn.kind === "codex-device") yield* this.#codexLogin.cancel(null);
        else yield* this.#cancelCliLogin(provider, null);
        return this.status();
      }),
    );
  }).bind(this);

  /**
   * The custom-endpoint wording, when there is a custom endpoint to talk about.
   *
   * OpenCode answers "not signed in" for a refused key or an unreachable base URL exactly as it does
   * for a missing account, so once an endpoint exists the default advice - run `opencode auth login`
   * - sends the user to the wrong fix. Returns null when the usual message is still right, so every
   * caller keeps its own default.
   */
  #customProviderSignInMessage(provider: AgentProvider): string | null {
    const count = provider === "opencode" ? this.#credentials.customProviders().length : 0;
    return count > 0 ? openCodeSignInMessage(count) : null;
  }

  /**
   * Replaces the OpenCode process so a changed custom-provider config reaches it.
   *
   * `connectProvider` cannot do this: it returns early for a provider that is already connected, so
   * it never respawns a running OpenCode. This reuses the rest of that path unchanged - re-resolve
   * the CLI, build a fresh client, swap it in, refresh the model catalogue - and threads survive it,
   * because a provider session id lives in `projection_provider_sessions` and is resumed.
   *
   * One `opencode acp` process serves every OpenCode agent, so a respawn is felt account-wide. That
   * is why a turn in progress wins: the config is only read at spawn, so skipping costs nothing
   * durable, and the next connect or app start picks the endpoint up.
   *
   * It reports how the respawn went and never throws, because the caller has already written the
   * endpoint to disk: a throw here would read to the user as a save that failed. A respawn that
   * fails - an endpoint OpenCode refuses at spawn - is reported the way every other connection
   * failure is, as an error state and a message on the provider's own status.
   */

  readonly reloadOpenCodeConfig = Effect.fn("ProviderRuntime.reloadOpenCodeConfig")(function* (
    this: ProviderRuntime,
  ): Effect.fn.Return<CustomProviderRestart> {
    if (!this.#clients.has("opencode")) return "not-running";
    if (this.#hooks.isProviderBusy("opencode")) return "skipped-busy";
    const result = yield* Effect.result(
      this.#runProviderConnectionCommand("opencode", () => this.#reprobeProvider("opencode")),
    );
    if (Result.isFailure(result) && this.#hooks.isProviderBusy("opencode")) return "skipped-busy";
    return "restarted";
  }, Effect.uninterruptible).bind(this);

  /**
   * Restarts each running process that read the agent environment when it started, so the next
   * turn gets the new one. The rules of `reloadOpenCodeConfig` apply, and a restart that a turn
   * delays is applied by the idle check after the turn stops. A Workspace only process is replaced
   * at its next turn, because its key names the activation.
   */

  readonly reloadAgentEnvironment = Effect.fn("ProviderRuntime.reloadAgentEnvironment")(function* (
    this: ProviderRuntime,
  ) {
    yield* Effect.forEach(SPAWN_ENVIRONMENT_PROVIDERS, (provider) => this.#reloadAgentEnvironment(provider), {
      concurrency: "unbounded",
      discard: true,
    });
  }).bind(this);

  readonly #reloadAgentEnvironment = Effect.fn("ProviderRuntime.reloadEnvironmentForProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    this.#environmentReloadPending.delete(provider);
    if (!this.#clients.has(provider)) return;
    if (this.#hooks.isProviderBusy(provider)) {
      this.#environmentReloadPending.add(provider);
      return;
    }
    const result = yield* Effect.result(
      this.#runProviderConnectionCommand(provider, () => this.#reprobeProvider(provider)),
    );
    if (Result.isFailure(result) && this.#hooks.isProviderBusy(provider)) this.#environmentReloadPending.add(provider);
  }, Effect.uninterruptible);

  /**
   * Replaces the router of the custom agents, so a saved, changed or removed agent reaches it. The
   * same rules as `reloadOpenCodeConfig` apply: a turn in progress wins, and it never throws. The
   * first saved agent starts the provider; with the last one removed, the provider stops. A change
   * that a turn delays is applied by the idle check after the turn stops, as the saved message says.
   */

  readonly reloadCustomAgents = Effect.fn("ProviderRuntime.reloadCustomAgents")(function* (this: ProviderRuntime) {
    this.#customAgentsReloadPending = false;
    const result = yield* this.#reloadCustomAgents();
    if (result === "skipped-busy") this.#customAgentsReloadPending = true;
    return result;
  }, Effect.uninterruptible).bind(this);

  readonly #reloadCustomAgents = Effect.fn("ProviderRuntime.reloadCustomAgentProcess")(function* (
    this: ProviderRuntime,
  ): Effect.fn.Return<CustomProviderRestart, ProviderOperationFailed> {
    if (!this.#clients.has("acp")) {
      if (this.#released.has("acp") || savedCustomAgents(this.#credentials).length === 0) return "not-running";
      yield* this.refreshProvider("acp").pipe(
        Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
      );
      return this.#clients.has("acp") ? "restarted" : "not-running";
    }
    if (this.#hooks.isProviderBusy("acp")) return "skipped-busy";
    const result = yield* Effect.result(this.#runProviderConnectionCommand("acp", () => this.#reprobeProvider("acp")));
    if (Result.isFailure(result)) {
      if (this.#hooks.isProviderBusy("acp")) return "skipped-busy";
      if (savedCustomAgents(this.#credentials).length === 0) yield* this.#stopProviderClient("acp");
    }
    return "restarted";
  }, Effect.uninterruptible);

  /** Stops a provider's shared process and every Workspace only process of it, with no restart. */
  readonly #stopProviderClient = Effect.fn("ProviderRuntime.stopProviderClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const client = this.#clients.get(provider);
    if (!client) return;
    // Remove ownership first so a process exit cannot start a replacement.
    yield* providerStep(() => {
      this.#clients.delete(provider);
      this.#cli.delete(provider);
      this.#accounts.delete(provider);
      this.#conversation.unloadClientThreads(client);
    });
    yield* client.stop().pipe(Effect.catch(() => Effect.void));
    yield* this.#hooks.onClientStopped(client);
    yield* Effect.forEach(
      [...this.#confined].filter(([, confined]) => confined.client.provider === provider),
      ([agentId, confined]) => this.#stopConfined(agentId, confined),
      { concurrency: "unbounded", discard: true },
    );
  }, Effect.uninterruptible);

  /**
   * Changes a provider's stored credential and restarts the provider on it, as one step.
   *
   * A CLI reads its credential when it spawns, so a new key only takes effect in a new process.
   * The change runs inside the provider's serialized connection command, after any start or refresh
   * already queued for it, and before the restart. A provider that is working on a turn keeps both
   * its process and its old credential, and the caller hears why. `#replacingCli` holds new
   * deliveries from the busy check to the restart, so no turn can start on the old process in
   * between. Success means that a new process runs with the new credential.
   */
  changeProviderCredential(
    provider: AgentProvider,
    change: () => Effect.Effect<void, ProviderOperationFailed>,
  ): Effect.Effect<AgentStatus, ProviderOperationFailed> {
    return this.#runProviderConnectionCommand(provider, () => this.#changeCredential(provider, change));
  }

  readonly #changeCredential = Effect.fn("ProviderRuntime.changeCredential")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    change: () => Effect.Effect<void, ProviderOperationFailed>,
  ) {
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    if (this.#hooks.isProviderBusy(provider))
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.cliBusyRetry", { provider: providerLabel(provider) })),
      });
    this.#replacingCli.add(provider);
    recordRestartActivity();
    yield* change().pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          this.#replacingCli.delete(provider);
          this.#hooks.onProviderResumed(provider);
        }),
      ),
    );
    return yield* this.#reprobeProvider(provider);
  }, Effect.uninterruptible);

  /** Keeps this provider idle until its managed runtime is installed and activated. */
  updateProviderCli(
    provider: AgentProvider,
    install: () => Effect.Effect<string, ProviderOperationFailed>,
  ): Effect.Effect<AgentStatus, ProviderOperationFailed> {
    return this.#runProviderConnectionCommand(provider, () => this.#updateProviderCli(provider, install));
  }

  readonly #updateProviderCli = Effect.fn("ProviderRuntime.updateCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    install: () => Effect.Effect<string, ProviderOperationFailed>,
  ) {
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    yield* providerStep(() => {
      if ((provider === "codex" && this.#codexLogin.pending) || this.#cliLogins.has(provider))
        throw new Error(sourceText("error.provider.cliSigningIn", { provider: providerLabel(provider) }));
      if (this.#hooks.isProviderBusy(provider))
        throw new Error(sourceText("error.provider.cliBusyUpdate", { provider: providerLabel(provider) }));
    });
    const previousVersion = this.#cli.get(provider)?.version ?? null;
    const previousExecutable = this.#bundledExecutables[provider];
    let installed = false;
    yield* Effect.acquireUseRelease(
      providerStep(() => {
        this.#setProviderConnectionState(provider, "connecting");
        this.#replacingCli.add(provider);
        recordRestartActivity();
      }),
      () =>
        Effect.gen({ self: this }, function* () {
          const executable = yield* install();
          installed = true;
          this.#bundledExecutables[provider] = executable;
          const cli = yield* this.#resolveProviderCli(provider);
          if (cli.source !== "managed" || cli.executable !== executable)
            return yield* new ProviderOperationFailed({
              cause: new Error(sourceText("error.provider.cliSelectFailed")),
            });
          yield* this.#reloadProviderCli(provider, cli);
        }).pipe(
          Effect.mapError((error) => {
            this.#bundledExecutables[provider] = previousExecutable;
            const cause = error.cause;
            const failure = new Error(
              sourceText("error.provider.cliUpdateFailed", {
                provider: providerLabel(provider),
                reason: cause instanceof Error ? redactText(cause.message) : sourceText("error.provider.tryAgain"),
              }),
              { cause },
            );
            this.#setProviderConnectionFailure(provider, failure, previousVersion, installed);
            return new ProviderOperationFailed({ cause: failure });
          }),
        ),
      () =>
        Effect.sync(() => {
          this.#replacingCli.delete(provider);
          this.#hooks.onProviderResumed(provider);
        }),
    );
    return this.status();
  }, Effect.uninterruptible);

  /**
   * The process that runs this agent's turns. A Workspace only agent on Grok or OpenCode has a process
   * of its own, and it is kept until the next turn starts even when the access changes, because a turn
   * that runs on it must still be steered and interrupted there. `ensureAgentClient` replaces it.
   */
  clientForAgent(agent: AgentSummary): AgentClient | null {
    const confined = this.#confined.get(agent.id);
    if (confined) {
      confined.lastUsed = Date.now();
      return confined.client;
    }
    return this.#confinementFor(agent) ? null : this.clientFor(providerForAgent(agent));
  }

  /** True while this agent has a process of its own, or one starts. An exit of the shared process leaves it. */
  runsOnOwnProcess(agentId: string): boolean {
    return this.#confined.has(agentId) || this.#confinedStarts.has(agentId);
  }

  /**
   * Like `requireReadyClient`, for the process that runs this agent's turns. An agent's own process
   * does not need the shared one, so its turn can still be interrupted while the shared one restarts.
   */
  requireReadyClientForAgent(agent: AgentSummary): AgentClient {
    const provider = providerForAgent(agent);
    if (!this.#confined.has(agent.id) && !this.#confinementFor(agent)) return this.requireReadyClient(provider);
    const client = this.clientForAgent(agent);
    if (!client) throw new Error(sourceText("error.provider.noAgentProcess", { provider: providerLabel(provider) }));
    return client;
  }

  /**
   * The process for this agent's next turn, started when it is needed. Call it only while the agent
   * runs no turn: it stops the agent's own process when that process no longer matches the agent.
   */

  readonly ensureAgentClient = Effect.fn("ProviderRuntime.ensureAgentClient")(function* (
    this: ProviderRuntime,
    agent: AgentSummary,
  ) {
    const provider = providerForAgent(agent);
    yield* this.ensureProvider(provider);
    for (let pending = this.#confinedStarts.get(agent.id); pending; pending = this.#confinedStarts.get(agent.id)) {
      const currentStart = pending;
      yield* Deferred.await(currentStart).pipe(Effect.ignore);
    }
    const confinement = this.#confinementFor(agent);
    const current = this.#confined.get(agent.id);
    const key = confinement ? this.#confinedKey(provider, confinement) : null;
    if (current && current.key === key) {
      current.lastUsed = Date.now();
      return current.client;
    }
    if (current) yield* this.#stopConfined(agent.id, current);
    if (!confinement || !key) return yield* providerStep(() => this.requireReadyClient(provider));
    const completion = Deferred.makeUnsafe<AgentClient, ProviderOperationFailed>();
    this.#confinedStarts.set(agent.id, completion);
    const exit = yield* Effect.exit(this.#startConfined(agent.id, provider, confinement, key));
    yield* Deferred.done(completion, exit);
    if (this.#confinedStarts.get(agent.id) === completion) this.#confinedStarts.delete(agent.id);
    return yield* exit;
  }, Effect.uninterruptible).bind(this);

  #countActivation(provider: AgentProvider): void {
    this.#activations.set(provider, (this.#activations.get(provider) ?? 0) + 1);
  }

  /** What a Workspace only agent's own process may write, or null when the agent needs no such process. */
  #confinementFor(agent: AgentSummary): ProcessConfinement | null {
    const provider = providerForAgent(agent);
    if (!workspaceAccessEnforced(agent)) return null;
    if (agentProviderDescriptor(provider).workspaceEnforcement !== "confined-process") return null;
    return { writableRoots: workspaceWritableRoots(agent, this.#hooks.sharedRoot()) };
  }

  /**
   * The shared process is part of the key: it is replaced when the CLI, a stored key or the custom
   * endpoints change, and the agent's own process must then start again with the same values.
   */
  #confinedKey(provider: AgentProvider, confinement: ProcessConfinement): string {
    const cli = this.#cli.get(provider);
    return JSON.stringify([
      cli?.executable ?? null,
      cli?.version ?? null,
      this.#activations.get(provider) ?? 0,
      confinement.writableRoots,
    ]);
  }

  readonly #startConfined = Effect.fn("ProviderRuntime.startConfined")(function* (
    this: ProviderRuntime,
    agentId: string,
    provider: AgentProvider,
    confinement: ProcessConfinement,
    key: string,
  ) {
    const cli = this.#cli.get(provider);
    if (!cli)
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) })),
      });
    const disposals = this.#disposals;
    const { client } = yield* this.#authenticateClient(provider, cli, { confinement });
    if (disposals !== this.#disposals || this.#hooks.isStopping()) {
      yield* client.stop().pipe(Effect.catch(() => Effect.void));
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.stoppedBeforeAgentProcess", { provider: providerLabel(provider) })),
      });
    }
    this.#confined.set(agentId, { client, key, lastUsed: Date.now() });
    logger.info("Started a Workspace only provider process.", { provider, agentId });
    return client;
  }, Effect.uninterruptible);

  /** Out of the map before it stops, so the exit reads as expected, not as a crash. */
  readonly #stopConfined = Effect.fn("ProviderRuntime.stopConfined")(function* (
    this: ProviderRuntime,
    agentId: string,
    confined: ConfinedClient,
  ) {
    yield* providerStep(() => {
      if (this.#confined.get(agentId) === confined) this.#confined.delete(agentId);
      this.#conversation.unloadClientThreads(confined.client);
    });
    yield* confined.client.stop().pipe(Effect.catch(() => Effect.void));
    yield* this.#hooks.onClientStopped(confined.client);
  }, Effect.uninterruptible);

  /** True when `client` was an agent's own process. Its exit restarts nothing; see `onAgentClientLost`. */
  #handleConfinedExit(client: AgentClient, error: Error): boolean {
    const entry = [...this.#confined].find(([, confined]) => confined.client === client);
    if (!entry) return false;
    const [agentId] = entry;
    this.#confined.delete(agentId);
    if (this.#hooks.isStopping()) return true;
    Effect.runFork(client.stop().pipe(Effect.ignore, Effect.forkIn(this.#scope)));
    this.#conversation.unloadClientThreads(client);
    Effect.runFork(this.#hooks.onAgentClientLost(agentId, client).pipe(Effect.forkIn(this.#scope)));
    this.#emitProviderError(client.provider, "exited", new Error(this.#redactMcp(error.message)), agentId);
    return true;
  }

  /**
   * True while a managed runtime is installed and its previous client is replaced, and while a
   * restart the user asked for waits for the provider's turns to end.
   */
  isReplacingCli(provider: AgentProvider): boolean {
    return this.#replacingCli.has(provider) || this.#restartsWhenIdle.has(provider);
  }

  /**
   * Stops and starts the provider's process, then reads its version, account and models again. The
   * turns that run on it end first; new turns of the provider wait, and other providers keep working.
   * It answers when the restart is scheduled. A provider with no process is checked again at once:
   * a stopped idle one starts, and one that failed or is signed out is asked again.
   */
  readonly restartProviderWhenIdle = Effect.fn("ProviderRuntime.restartProviderWhenIdle")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    if (this.#restartsWhenIdle.has(provider)) return this.status();
    if (!this.#clients.has(provider)) {
      if (this.#released.has(provider)) {
        // A failed start is reported on the provider status, as for a turn that wakes it.
        yield* this.ensureProvider(provider)
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })))
          .pipe(Effect.ignore);
        return this.status();
      }
      return yield* this.refreshProvider(provider).pipe(
        Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
      );
    }
    yield* providerStep(() => {
      this.#restartsWhenIdle.set(provider, null);
      recordRestartActivity();
      this.#setStatus({});
    });
    yield* this.#checkRestartWhenIdle(provider);
    return this.status();
  }).bind(this);

  /** Removes a restart that still waits for turns to end. One that already runs goes on. */
  cancelProviderRestart(provider: AgentProvider): AgentStatus {
    const timer = this.#restartsWhenIdle.get(provider);
    if (!timer) return this.status();
    clearTimeout(timer);
    this.#endRestartWhenIdle(provider);
    return this.status();
  }

  readonly #checkRestartWhenIdle = Effect.fn("ProviderRuntime.checkRestartWhenIdle")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ): Effect.fn.Return<void> {
    if (!this.#restartsWhenIdle.has(provider)) return;
    const waiting =
      this.#status.phase !== "ready" ||
      this.#hooks.isProviderBusy(provider) ||
      this.#providerStarts.has(provider) ||
      this.#providerConnectionCommands.has(provider) ||
      this.#replacingCli.has(provider) ||
      this.#cliLogins.has(provider) ||
      (provider === "codex" && this.#codexLogin.pending);
    if (waiting) {
      const timer = setTimeout(
        () => Effect.runFork(this.#checkRestartWhenIdle(provider).pipe(Effect.forkIn(this.#scope))),
        PROVIDER_RESTART_POLL_MS,
      );
      timer.unref?.();
      this.#restartsWhenIdle.set(provider, timer);
      return;
    }
    this.#restartsWhenIdle.set(provider, null);
    const disposals = this.#disposals;
    yield* this.#runProviderConnectionCommand(provider, () =>
      this.#clients.has(provider) ? this.#reprobeProvider(provider).pipe(Effect.asVoid) : Effect.void,
    ).pipe(
      Effect.match({ onSuccess: () => true, onFailure: () => !this.#hooks.isProviderBusy(provider) }),
      Effect.flatMap((done) => {
        if (disposals !== this.#disposals || !this.#restartsWhenIdle.has(provider)) return Effect.void;
        if (done) return Effect.sync(() => this.#endRestartWhenIdle(provider));
        return this.#checkRestartWhenIdle(provider);
      }),
      Effect.forkIn(this.#scope),
    );
  });

  #endRestartWhenIdle(provider: AgentProvider): void {
    this.#restartsWhenIdle.delete(provider);
    this.#setStatus({});
    this.#hooks.onProviderResumed(provider);
  }

  requireReadyClient(provider: AgentProvider): AgentClient {
    const client = this.clientFor(provider);
    if (!client || this.#status.phase !== "ready") {
      throw new Error(
        this.#status.message ?? sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) }),
      );
    }
    return client;
  }

  /** Router arm: the CLI reports a finished ChatGPT browser login. */
  readonly completeCodexLogin = Effect.fn("ProviderRuntime.completeCodexLogin")(function* (
    this: ProviderRuntime,
    params: unknown,
    source: AgentClient,
    decode: (params: unknown) => AccountLoginCompletedResult,
  ) {
    const decoded = yield* Effect.result(providerStep(() => decode(params)));
    if (Result.isFailure(decoded)) return yield* this.#codexLogin.failUnverified();
    yield* this.#runProviderConnectionCommand("codex", () => this.#codexLogin.complete(decoded.success, source));
  }).bind(this);

  /**
   * Pushed by the main process, which owns the Computer Use driver.
   *
   * Nothing here probes for it. The capability follows the driver daemon and its macOS grants, not
   * a provider: the driver reaches Codex, Claude and the ACP providers through one MCP entry, so a
   * value derived from any single client would be wrong for the other two.
   */
  setComputerUseCapability(computerUse: CapabilityState): void {
    this.#setStatus({ capabilities: { ...this.#status.capabilities, computerUse } });
  }

  /** Router arm: the CLI pushed new rate limits. */
  readonly refreshCodexUsage = Effect.fn("ProviderRuntime.refreshCodexUsage")(function* (this: ProviderRuntime) {
    const client = this.#clients.get("codex");
    if (client) yield* this.#refreshUsage(client, undefined, false).pipe(Effect.ignore);
  }).bind(this);

  /** Refresh the notice once when one provider reports the same exhausted balance several ways. */
  readonly refreshUsageAfterLimit = Effect.fn("ProviderRuntime.refreshUsageAfterLimit")(function* (
    this: ProviderRuntime,
    source: AgentClient,
  ) {
    const client = this.#clients.get(source.provider);
    if (!client || this.#usageLimitRefreshes.has(client)) return;
    this.#usageLimitRefreshes.add(client);
    yield* this.#refreshUsage(client).pipe(
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => this.#usageLimitRefreshes.delete(client))),
      Effect.forkIn(this.#scope),
    );
  }).bind(this);

  /**
   * The provider half of stop(). Returns the clients the caller still has to await, because
   * stop() interleaves that wait with the mailbox and image-generation teardown.
   */
  readonly dispose = Effect.fn("ProviderRuntime.dispose")(function* (this: ProviderRuntime) {
    this.#disposals += 1;
    for (const timer of this.#restartTimers.values()) clearTimeout(timer);
    this.#restartTimers.clear();
    for (const timer of this.#restartsWhenIdle.values()) if (timer) clearTimeout(timer);
    this.#restartsWhenIdle.clear();
    if (this.#idleCheck) clearInterval(this.#idleCheck);
    this.#idleCheck = null;
    this.#released.clear();
    const loginClient = this.#codexLogin.dispose();
    const cliLogins = [...this.#cliLogins.values()];
    this.#cliLogins.clear();
    this.#providerConnectionCommands.clear();
    for (const login of cliLogins) {
      yield* stopProcessTree(login.child).pipe(Effect.ignore);
      yield* Scope.close(login.scope, Exit.void);
    }
    const clients = [
      ...this.#clients.values(),
      ...[...this.#confined.values()].map((confined) => confined.client),
      ...(loginClient ? [loginClient] : []),
    ];
    this.#clients.clear();
    this.#confined.clear();
    yield* Scope.close(this.#scope, Exit.void);
    return clients;
  }, Effect.uninterruptible).bind(this);

  markStopped(): void {
    this.#setStatus({ phase: "stopped", message: null });
  }

  readonly #runProviderConnectionCommand = Effect.fn("ProviderRuntime.connectionCommand")(function* <T>(
    this: ProviderRuntime,
    provider: AgentProvider,
    command: () => Effect.Effect<T, ProviderOperationFailed>,
  ) {
    const previous = this.#providerConnectionCommands.get(provider);
    const completion = Deferred.makeUnsafe<void, ProviderOperationFailed>();
    this.#providerConnectionCommands.set(provider, completion);
    recordRestartActivity();
    if (previous) yield* Deferred.await(previous).pipe(Effect.ignore);
    const exit = yield* Effect.exit(Effect.suspend(command));
    yield* Deferred.done(completion, Exit.asVoid(exit));
    if (this.#providerConnectionCommands.get(provider) === completion)
      this.#providerConnectionCommands.delete(provider);
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (this: ProviderRuntime) {
    yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS,
      (driver) =>
        this.#runProviderConnectionCommand(driver.id, () =>
          driver.signIn.kind === "browser"
            ? this.#codexLogin.settleForRefresh()
            : this.#cancelCliLogin(driver.id, null),
        ).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause }))),
      { concurrency: "unbounded", discard: true },
    );

    const activeClients = [...this.#clients];
    if (activeClients.length > 0) {
      let providers = this.#status.providers;
      for (const [provider] of activeClients) {
        providers = updateProviderStatus(providers, provider, {
          state: "checking",
          version: this.#cli.get(provider)?.version ?? null,
          message: null,
          email: this.#accounts.get(provider)?.email ?? null,
          checkError: null,
        });
      }
      this.#setStatus({ providers });
    }
    yield* Effect.forEach(activeClients, ([provider, client]) => this.#refreshAccount(provider, client), {
      concurrency: "unbounded",
      discard: true,
    });

    const providers = BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id);
    // Join earlier starts before claiming their provider slots.
    const pendingStarts = () => providers.flatMap((provider) => this.#providerStarts.get(provider) ?? []);
    for (let pending = pendingStarts(); pending.length > 0; pending = pendingStarts()) {
      yield* Effect.forEach(pending, (start) => Deferred.await(start).pipe(Effect.ignore), {
        concurrency: "unbounded",
        discard: true,
      });
    }
    const starting = providers.filter((provider) => !this.#clients.has(provider));
    for (const provider of starting) this.#resetRestarts(provider);
    const completion = Deferred.makeUnsafe<void, ProviderOperationFailed>();
    for (const provider of starting) this.#providerStarts.set(provider, completion);
    const exit = yield* Effect.exit(
      this.#connect("starting", providers, { preserveCheckErrors: true, refreshRuntimeInBackground: true }),
    );
    yield* Deferred.done(completion, exit);
    for (const provider of starting)
      if (this.#providerStarts.get(provider) === completion) this.#providerStarts.delete(provider);
    yield* exit;
    return this.status();
  }, Effect.uninterruptible);

  readonly #refreshAccount = Effect.fn("ProviderRuntime.refreshAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    client: AgentClient,
  ) {
    const result = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        const account = yield* client
          .request("account/read", { refreshToken: true }, decodeAccountReadResult, 5_000)
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
        // An activation can replace this client while the account request is pending.
        if (this.#clients.get(provider) !== client) return;
        if (account.account) {
          const value = account.account;
          yield* providerStep(() => requireProviderDriver(provider).validateAccount(value));
          this.#accounts.set(provider, value);
          this.#setStatus({
            providers: updateProviderStatus(this.#status.providers, provider, {
              state: "available",
              version: this.#cli.get(provider)?.version ?? null,
              message: null,
              email: value.email ?? null,
              checkError: null,
            }),
          });
          return;
        }
        this.#clients.delete(provider);
        this.#cli.delete(provider);
        this.#accounts.delete(provider);
        yield* client
          .stop()
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })))
          .pipe(Effect.ignore);
        yield* this.#hooks.onClientStopped(client);
        yield* Effect.forEach(
          [...this.#confined].filter(([, confined]) => confined.client.provider === provider),
          ([agentId, confined]) => this.#stopConfined(agentId, confined),
          { concurrency: "unbounded", discard: true },
        );
      }),
    );
    if (Result.isFailure(result) && this.#clients.get(provider) === client) {
      const label = provider === "codex" ? "ChatGPT" : providerLabel(provider);
      this.#setStatus({
        providers: updateProviderStatus(this.#status.providers, provider, {
          state: "available",
          version: this.#cli.get(provider)?.version ?? null,
          message: null,
          email: this.#accounts.get(provider)?.email ?? null,
          checkError: `Could not verify ${label}. Keeping the existing connection.`,
        }),
      });
    }
  });

  /** A CLI exit with its last stderr line in the message, after the MCP values are out of it. */
  #withExitDetail(error: unknown): unknown {
    return error instanceof AgentProcessExitError ? error.withDetail(this.#redactMcp) : error;
  }

  readonly #authenticateClient = Effect.fn("ProviderRuntime.authenticateClient")(
    function* (
      this: ProviderRuntime,
      provider: AgentProvider,
      cli: AgentCliInfo,
      { confinement, startTimeoutMs }: { confinement?: ProcessConfinement; startTimeoutMs?: number } = {},
    ) {
      const driver = requireProviderDriver(provider);
      let transferred = false;
      return yield* Effect.acquireUseRelease(
        providerStep(() =>
          this.#clientFactory
            ? this.#clientFactory(provider, cli, confinement)
            : driver.createClient(cli, this.#requestTimeoutMs, this.#credentials, confinement),
        ),
        (client) =>
          Effect.gen({ self: this }, function* () {
            yield* providerStep(() => {
              this.#bindClient(client);
              client.start();
            });
            yield* client
              .request(
                "initialize",
                {
                  clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
                  capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
                },
                decodeRecordResponse,
                startTimeoutMs,
              )
              .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
            yield* providerStep(() => client.notify("initialized"));
            const response = yield* client
              .request("account/read", { refreshToken: true }, decodeAccountReadResult)
              .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
            const account = response.account;
            if (!account)
              return yield* new ProviderOperationFailed({
                cause: new Error(
                  this.#customProviderSignInMessage(provider) ??
                    sourceText("error.provider.noAuthenticatedAccount", { provider: providerLabel(provider) }),
                ),
              });
            yield* providerStep(() => driver.validateAccount(account));
            transferred = true;
            return { client, account };
          }),
        (client) => (transferred ? Effect.void : client.stop().pipe(Effect.catch(() => Effect.void))),
      );
    },
    Effect.mapError((failure) => new ProviderOperationFailed({ cause: this.#withExitDetail(failure.cause) })),
  );

  readonly #activateProviderClient = Effect.fn("ProviderRuntime.activateClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    client: AgentClient,
    cli: AgentCliInfo,
    account: NonNullable<AccountReadResult["account"]>,
    options: { isCurrent?: () => boolean; notifyReady?: boolean } = {},
  ) {
    return yield* this.#providerActivation.withPermit(
      Effect.gen({ self: this }, function* () {
        const { isCurrent, notifyReady = true } = options;
        const stopCandidate = client.stop().pipe(Effect.catch(() => Effect.void));
        if (isCurrent && !isCurrent()) {
          yield* stopCandidate;
          return;
        }
        const previousClient = this.#clients.get(provider);
        const previousCli = this.#cli.get(provider);
        const previousAccount = this.#accounts.get(provider);
        const wasReleased = this.#released.delete(provider);
        if (!wasReleased && previousClient !== client) this.#countActivation(provider);
        this.#clients.set(provider, client);
        this.#cli.set(provider, cli);
        this.#accounts.set(provider, account);
        const restorePrevious = Effect.gen({ self: this }, function* () {
          if (previousClient) this.#clients.set(provider, previousClient);
          else this.#clients.delete(provider);
          if (previousCli) this.#cli.set(provider, previousCli);
          else this.#cli.delete(provider);
          if (previousAccount) this.#accounts.set(provider, previousAccount);
          else this.#accounts.delete(provider);
          if (client !== previousClient) yield* stopCandidate;
        });
        const updated = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            const freshCatalogs = yield* this.#refreshModelCatalog();
            if (isCurrent && !isCurrent()) return false;
            yield* providerStep(() => {
              const primaryProvider = this.#clients.has(this.#preferredProvider)
                ? this.#preferredProvider
                : this.#clients.has("codex")
                  ? "codex"
                  : provider;
              const primaryAccount = this.#accounts.get(primaryProvider);
              this.#conversation.clearLoadedThreads();
              this.#setStatus({
                phase: "ready",
                cliVersion: this.#cli.get(primaryProvider)?.version ?? null,
                auth: requireProviderDriver(primaryProvider).authState(primaryAccount ?? null),
                providers: updateProviderStatus(this.#status.providers, provider, {
                  state: "available",
                  version: cli.version,
                  message: null,
                  email: account.email ?? null,
                }),
                capabilities: { ...this.#status.capabilities, chat: "ready", browser: "ready" },
                message: null,
              });
            });
            // Only the catalog reported by this client proves that an endpoint is available.
            if (freshCatalogs.has(provider))
              yield* this.#hooks
                .onProviderActivated(provider, this.#configRevisions.get(client) ?? 0)
                .pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
            return true;
          }),
        );
        if (Result.isFailure(updated)) {
          yield* restorePrevious;
          return yield* updated.failure;
        }
        if (!updated.success) {
          yield* restorePrevious;
          return;
        }
        if (previousClient && previousClient !== client) {
          yield* previousClient.stop().pipe(Effect.catch(() => Effect.void));
          yield* this.#hooks.onClientStopped(previousClient);
        }
        if (provider === "codex") yield* this.#refreshUsage(client).pipe(Effect.ignore, Effect.forkIn(this.#scope));
        if (notifyReady)
          yield* this.#hooks
            .onProvidersReady()
            .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
      }),
    );
  }, Effect.uninterruptible);

  #setProviderConnectionState(provider: AgentProvider, connectionState: "connecting"): void {
    const current = this.#status.providers?.find((candidate) => candidate.id === provider);
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: this.#clients.has(provider) ? "available" : (current?.state ?? "checking"),
        version: this.#cli.get(provider)?.version ?? current?.version ?? null,
        message: null,
        email: this.#accounts.get(provider)?.email ?? current?.email ?? null,
        connectionState,
      }),
    });
  }

  #clearProviderConnectionState(provider: AgentProvider): void {
    const current = this.#status.providers?.find((candidate) => candidate.id === provider);
    if (!current?.connectionState) return;
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: this.#clients.has(provider) ? "available" : current.state,
        version: this.#cli.get(provider)?.version ?? current.version,
        message: null,
        email: this.#accounts.get(provider)?.email ?? current.email ?? null,
      }),
    });
  }

  /**
   * `cliFailed` is for a failure of the CLI itself, such as an update that installed a CLI which does
   * not start. A CLI that stopped before it answered is one as well. Such a provider needs the CLI
   * fixed, not a sign-in, so its status says so.
   */
  #setProviderConnectionFailure(
    provider: AgentProvider,
    error: unknown,
    version?: string | null,
    cliFailed = error instanceof AgentProcessExitError,
  ): void {
    const hasActiveClient = this.#clients.has(provider);
    const fallbackMessage = `OpenBot could not connect ${providerLabel(provider)}. Try again.`;
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = /^(ChatGPT connection|OpenBot)/u.test(rawMessage) ? rawMessage : fallbackMessage;
    const status = hasActiveClient
      ? {
          state: "available" as const,
          version: this.#cli.get(provider)?.version ?? version ?? null,
          message,
          email: this.#accounts.get(provider)?.email ?? null,
        }
      : error instanceof CodexCliError || cliFailed
        ? providerFailureStatus(provider, error, version)
        : {
            state: "sign-in-required" as const,
            version: version ?? null,
            message,
            email: null,
          };
    const hasProvider = this.#clients.size > 0 || this.#released.size > 0;
    this.#setStatus({
      phase: hasProvider ? "ready" : "blocked",
      providers: updateProviderStatus(this.#status.providers, provider, status),
      capabilities: { ...this.#status.capabilities, chat: hasProvider ? "ready" : "unavailable" },
      message: hasProvider ? null : message,
    });
  }

  /** Puts a provider back on the binary that is on disk now, after a managed update. */
  readonly #reloadProviderCli = Effect.fn("ProviderRuntime.reloadProviderCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    cli: AgentCliInfo,
  ) {
    if (!this.#clients.has(provider)) {
      yield* providerStep(() => {
        this.#clearProviderConnectionState(provider);
        this.#cli.delete(provider);
      });
      // Other providers can have live turns. Replacement must not run start recovery.
      yield* this.#connect("starting", [provider], {
        preserveCheckErrors: true,
        notifyReady: false,
        startTimeoutMs: INSTALLED_CLI_START_TIMEOUT_MS,
      });
      const status = this.status().providers?.find((row) => row.id === provider);
      if (status?.version !== cli.version || !["available", "sign-in-required"].includes(status.state)) {
        return yield* new ProviderOperationFailed({
          cause: new Error(status?.message ?? sourceText("error.provider.cliActivateFailed")),
        });
      }
      return;
    }
    const candidate = yield* this.#authenticateClient(provider, cli, {
      startTimeoutMs: INSTALLED_CLI_START_TIMEOUT_MS,
    });
    yield* this.#activateProviderClient(provider, candidate.client, cli, candidate.account, {
      notifyReady: false,
    }).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
  }, Effect.uninterruptible);

  /**
   * Connects a provider that OpenBot never spawns a login for. The user signed in with the
   * provider's own CLI in a terminal, so this only starts a fresh client and asks the provider
   * which account it now has. A provider with a free tier answers with an account either way.
   */

  readonly #reprobeProvider = Effect.fn("ProviderRuntime.reprobeProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    if (this.#hooks.isProviderBusy(provider)) {
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.cliBusyReconnect", { provider: providerLabel(provider) })),
      });
    }
    let cli: AgentCliInfo | null = null;
    return yield* Effect.acquireUseRelease(
      providerStep(() => {
        this.#setProviderConnectionState(provider, "connecting");
        this.#replacingCli.add(provider);
        recordRestartActivity();
      }),
      () =>
        Effect.gen({ self: this }, function* () {
          const resolved = yield* this.#resolveProviderCli(provider);
          cli = resolved;
          const candidate = yield* this.#authenticateClient(provider, resolved);
          yield* this.#activateProviderClient(provider, candidate.client, resolved, candidate.account, {
            notifyReady: false,
          }).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
          yield* providerStep(() => this.#clearProviderConnectionState(provider));
          return this.status();
        }).pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => this.#setProviderConnectionFailure(provider, failure.cause, cli?.version)),
          ),
        ),
      () =>
        Effect.sync(() => {
          this.#replacingCli.delete(provider);
          this.#hooks.onProviderResumed(provider);
        }),
    );
  }, Effect.uninterruptible);

  readonly #startCliLogin = Effect.fn("ProviderRuntime.startCliLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    start: (cli: AgentCliInfo) => Effect.Effect<
      {
        child: ChildProcess;
        done: Effect.Effect<void, ProviderClientOperationError | CliCodeLoginFailed | ProviderProcessFailed>;
      } & Partial<Pick<CliCodeLogin, "prompt" | "submit">>,
      ProviderClientOperationError | CliCodeLoginFailed | ProviderOperationFailed,
      Scope.Scope
    >,
  ) {
    let cli: AgentCliInfo | null = null;
    this.#setProviderConnectionState(provider, "connecting");
    return yield* Effect.gen({ self: this }, function* () {
      const resolved = yield* this.#resolveProviderCli(provider);
      cli = resolved;
      const scope = Scope.makeUnsafe();
      const { child, done, prompt, submit } = yield* start(resolved).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      const pending: PendingCliLogin = {
        child,
        cli: resolved,
        scope,
        task: null,
        ...(prompt && submit ? { code: { prompt, submit } } : {}),
      };
      this.#cliLogins.set(provider, pending);
      recordRestartActivity();
      // The login outlives the request; dispose/cancel owns the registered child and task.
      pending.task = yield* Effect.forkIn(
        done.pipe(
          Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
          Effect.flatMap(() => this.#completeCliLogin(provider, pending)),
          Effect.catch((failure) => this.#failCliLogin(provider, pending, failure.cause)),
          Effect.ensuring(Scope.close(scope, Exit.void)),
        ),
        this.#scope,
      );
      return this.status();
    }).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => this.#setProviderConnectionFailure(provider, failure.cause, cli?.version)),
      ),
    );
  }, Effect.uninterruptible);

  readonly #completeCliLogin = Effect.fn("ProviderRuntime.completeCliLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    pending: PendingCliLogin,
  ) {
    if (this.#cliLogins.get(provider) !== pending) return;
    yield* Effect.gen({ self: this }, function* () {
      const candidate = yield* this.#authenticateClient(provider, pending.cli);
      if (this.#cliLogins.get(provider) !== pending) {
        yield* candidate.client
          .stop()
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })))
          .pipe(Effect.ignore);
        return;
      }
      yield* this.#activateProviderClient(provider, candidate.client, pending.cli, candidate.account, {
        isCurrent: () => this.#cliLogins.get(provider) === pending,
      }).pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
      if (this.#cliLogins.get(provider) === pending) this.#cliLogins.delete(provider);
    }).pipe(
      Effect.catch((failure) =>
        this.#failCliLogin(provider, pending, failure.cause).pipe(
          Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
        ),
      ),
    );
  }, Effect.uninterruptible);

  readonly #failCliLogin = Effect.fn("ProviderRuntime.failCliLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    pending: PendingCliLogin,
    error: unknown,
  ) {
    if (this.#cliLogins.get(provider) !== pending) return;
    this.#cliLogins.delete(provider);
    yield* stopProcessTree(pending.child).pipe(
      Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
    );
    this.#setProviderConnectionFailure(provider, error, pending.cli.version);
  });

  readonly #cancelCliLogin = Effect.fn("ProviderRuntime.cancelCliLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    message: string | null,
  ) {
    const pending = this.#cliLogins.get(provider);
    if (!pending) return;
    this.#cliLogins.delete(provider);
    yield* stopProcessTree(pending.child).pipe(
      Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })),
    );
    yield* Scope.close(pending.scope, Exit.void);
    const task = pending.task;
    if (task) yield* Fiber.join(task).pipe(Effect.ignore);
    if (message) this.#setProviderConnectionFailure(provider, new Error(message), pending.cli.version);
    else this.#clearProviderConnectionState(provider);
  }, Effect.uninterruptible);

  readonly #connect = Effect.fn("ProviderRuntime.connect")(function* (
    this: ProviderRuntime,
    phase: "starting" | "restarting",
    requestedProviders: readonly AgentProvider[],
    options: {
      preserveCheckErrors?: boolean;
      refreshRuntimeInBackground?: boolean;
      notifyReady?: boolean;
      startTimeoutMs?: number;
    } = {},
  ) {
    const disposals = this.#disposals;
    const disposed = () => this.#hooks.isStopping() || disposals !== this.#disposals;
    const hadClients = this.#clients.size > 0 || this.#released.size > 0;
    const providerStatuses: AgentProviderStatus[] = structuredClone(
      this.#status.providers ?? INITIAL_STATUS.providers ?? [],
    );
    /** The version each row showed before this check, kept when the check times out. */
    const previousVersions = new Map<AgentProvider, string | null>();
    for (const provider of requestedProviders) {
      const current = this.#status.providers?.find((candidate) => candidate.id === provider);
      previousVersions.set(provider, this.#cli.get(provider)?.version ?? current?.version ?? null);
      setProviderStatus(providerStatuses, provider, {
        // A released provider is still connected: it only waits for a turn to start its process.
        state: this.#clients.has(provider) || this.#released.has(provider) ? "available" : "checking",
        version: previousVersions.get(provider) ?? null,
        message: null,
        email: this.#accounts.get(provider)?.email ?? null,
        checkError: options.preserveCheckErrors ? (current?.checkError ?? null) : null,
      });
    }
    this.#setStatus(
      hadClients
        ? { providers: providerStatuses }
        : {
            phase,
            auth: { kind: "unknown" },
            providers: providerStatuses,
            capabilities: { ...this.#status.capabilities, chat: "unavailable" },
            message: phase === "starting" ? "Starting local agent CLI…" : "Restarting local agent CLI…",
          },
    );

    /**
     * The providers this connect started itself. A client that was already running read the endpoint
     * files as they were then, so it says nothing about the files as they are now.
     */
    const activated: AgentProvider[] = [];
    const results = yield* Effect.forEach(
      requestedProviders,
      (provider) => {
        let client: AgentClient | null = null;
        let cli: AgentCliInfo | null = null;
        let stage = "cli";
        let stageStartedAt = performance.now();
        const stageMs = () => Math.round(performance.now() - stageStartedAt);
        return Effect.gen({ self: this }, function* () {
          if (this.#clients.has(provider)) return null;
          const driver = requireProviderDriver(provider);
          const resolvedCli = yield* this.#resolveProviderCli(provider);
          cli = resolvedCli;
          logger.info("Resolved a provider CLI.", {
            provider,
            command: basename(resolvedCli.executable),
            version: resolvedCli.version,
            source: resolvedCli.source ?? null,
            durationMs: stageMs(),
          });
          stage = "initialize";
          stageStartedAt = performance.now();
          const candidate = yield* providerStep(() =>
            this.#clientFactory
              ? this.#clientFactory(provider, resolvedCli)
              : driver.createClient(resolvedCli, this.#requestTimeoutMs, this.#credentials),
          );
          client = candidate;
          yield* providerStep(() => {
            this.#bindClient(candidate);
            candidate.start();
          });
          yield* candidate
            .request(
              "initialize",
              {
                clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
                capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
              },
              decodeRecordResponse,
              options.startTimeoutMs,
            )
            .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
          yield* providerStep(() => candidate.notify("initialized"));
          logger.info("A provider answered initialize.", { provider, durationMs: stageMs() });
          stage = "account";
          stageStartedAt = performance.now();
          const account = yield* candidate
            .request("account/read", { refreshToken: false }, decodeAccountReadResult, 5_000)
            .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
          if (!account.account) {
            const message =
              this.#customProviderSignInMessage(provider) ?? agentProviderDescriptor(provider).signInMessage;
            yield* candidate.stop().pipe(Effect.catch(() => Effect.void));
            this.#setStatus({
              providers: updateProviderStatus(this.#status.providers, provider, {
                state: "sign-in-required",
                version: resolvedCli.version,
                message,
                email: null,
              }),
            });
            return message;
          }
          const authenticated = account.account;
          yield* providerStep(() => driver.validateAccount(authenticated));
          // `stop()` does not wait for a start: a client added after its `dispose()` would run on.
          if (disposed()) {
            yield* candidate.stop().pipe(Effect.catch(() => Effect.void));
            return null;
          }
          if (!this.#released.has(provider)) this.#countActivation(provider);
          this.#cli.set(provider, resolvedCli);
          this.#clients.set(provider, candidate);
          this.#accounts.set(provider, account.account);
          activated.push(provider);
          this.#setStatus({
            providers: updateProviderStatus(this.#status.providers, provider, {
              state: "available",
              version: resolvedCli.version,
              message: null,
              email: account.account.email ?? null,
            }),
          });
          return null;
        }).pipe(
          Effect.catch((problem) =>
            Effect.gen({ self: this }, function* () {
              const failedClient = client;
              if (failedClient) yield* failedClient.stop().pipe(Effect.catch(() => Effect.void));
              const thrown = problem.cause;
              // Another start of this provider, such as a turn's during a refresh, finished first. Its
              // client runs and its row is current, so this failure describes nothing the app uses.
              if (this.#clients.has(provider)) return null;
              const error = this.#withExitDetail(thrown);
              logger.warn("A provider did not start.", {
                provider,
                stage,
                durationMs: stageMs(),
                timeout: isProviderTimeout(error),
                message: shortenDiagnostic(this.#redactMcp(error instanceof Error ? error.message : String(error))),
              });
              if (isProviderTimeout(error)) {
                this.#recordProviderError(provider, error);
                // A busy computer, not a broken CLI: say so, keep the version, and try again later.
                const message = this.#retryAfterTimeout(provider, !disposed());
                this.#setStatus({
                  providers: updateProviderStatus(this.#status.providers, provider, {
                    state: "error",
                    version: cli?.version ?? previousVersions.get(provider) ?? null,
                    message,
                  }),
                });
                return message;
              }
              // The CLI's own words reach the status message and the joined start failure below, so
              // the MCP values go first. `providerFailureStatus` applies only the generic redaction.
              const message = this.#redactMcp(error instanceof Error ? error.message : String(error));
              const failure = providerFailureStatus(provider, error, cli?.version);
              this.#setStatus({
                providers: updateProviderStatus(this.#status.providers, provider, {
                  ...failure,
                  message: failure.message === null ? null : this.#redactMcp(failure.message),
                }),
              });
              if (!(error instanceof CodexCliError)) this.#emitProviderError(provider, "start_failed", error);
              return message;
            }),
          ),
          Effect.onInterrupt(() => {
            const interruptedClient = client;
            return interruptedClient && this.#clients.get(provider) !== interruptedClient
              ? interruptedClient.stop().pipe(Effect.catch(() => Effect.void))
              : Effect.void;
          }),
        );
      },
      { concurrency: "unbounded" },
    );
    if (disposed()) return;
    for (const provider of requestedProviders) this.#released.delete(provider);
    const failures = results.filter((message): message is string => message !== null);
    const finalProviderStatuses = structuredClone(this.#status.providers ?? providerStatuses);

    if (this.#clients.size === 0 && this.#released.size > 0) {
      // Every other provider is released, not gone: chat stays ready and starts one on the next turn.
      this.#setStatus({ providers: finalProviderStatuses });
      return;
    }
    if (this.#clients.size === 0) {
      this.#setStatus({
        phase: "blocked",
        cliVersion: null,
        auth: { kind: "unknown" },
        providers: finalProviderStatuses,
        capabilities: { ...this.#status.capabilities, chat: "unavailable" },
        message: failures.join(" "),
      });
      return;
    }

    const primaryProvider = this.#clients.has(this.#preferredProvider)
      ? this.#preferredProvider
      : this.#clients.has("codex")
        ? "codex"
        : this.#clients.keys().next().value;
    if (!primaryProvider)
      return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.noneReady")) });
    const primaryAccount = this.#accounts.get(primaryProvider);
    for (const provider of activated) {
      this.#restartAttempts.delete(provider);
      if (options.notifyReady !== false) this.#exitRecovery.delete(provider);
    }
    this.#setStatus({
      phase: "ready",
      cliVersion: this.#cli.get(primaryProvider)?.version ?? null,
      auth: requireProviderDriver(primaryProvider).authState(primaryAccount ?? null),
      providers: finalProviderStatuses,
      capabilities: { ...this.#status.capabilities, chat: "ready", browser: "ready" },
      message: null,
    });
    const refreshRuntime = Effect.gen({ self: this }, function* () {
      const codexClient = this.#clients.get("codex");
      const freshCatalogs = yield* this.#refreshModelCatalog();
      for (const provider of activated) {
        const client = this.#clients.get(provider);
        // The same condition as the other activation site: a stale catalogue proves nothing about
        // the endpoints the process now answering was given.
        if (client && freshCatalogs.has(provider)) {
          yield* this.#hooks
            .onProviderActivated(provider, this.#configRevisions.get(client) ?? 0)
            .pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
        }
      }
      // The catalogue is read off the status, so discovery that found new models has to publish one.
      // This used to ride along with a Computer Use probe that no longer exists.
      this.#setStatus({});
      if (codexClient) yield* this.#refreshUsage(codexClient).pipe(Effect.ignore, Effect.forkIn(this.#scope));
      if (options.notifyReady !== false)
        yield* this.#hooks
          .onProvidersReady()
          .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
    });
    if (options.refreshRuntimeInBackground) {
      yield* refreshRuntime.pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#emitError("provider_metadata_refresh_failed", failure.cause)),
        ),
        Effect.catchDefect((error) => Effect.sync(() => this.#emitError("provider_metadata_refresh_failed", error))),
        Effect.forkIn(this.#scope),
      );
      return;
    }
    yield* refreshRuntime;
  });

  #bindClient(client: AgentClient): void {
    // Taken before `start()`, which is where the CLI reads the endpoint files.
    this.#configRevisions.set(client, this.#hooks.captureConfigRevision());
    this.#hooks.bindClient(client);
    const readAcpRequestEcho = createAcpRequestEchoReader();
    client.on("diagnostic", (raw, origin) => {
      const echo = readAcpRequestEcho(raw);
      if (echo !== undefined) {
        if (echo !== null) {
          stderrLogger.warn("A provider logged an error that it also sent as a reply.", {
            provider: client.provider,
            method: echo.method,
            message: echo.error === null ? null : shortenDiagnostic(this.#redactMcp(echo.error)),
          });
        }
        return;
      }
      if (!/error|failed|warning/i.test(raw)) return;
      // Redacted before the first use, not at each one. A CLI reports an MCP failure by quoting
      // what it sent, so an API key or an inherited credential is in the line that is about to be
      // logged or turned into a renderer error event. Shortened after that, because a value cut in
      // half is a value the redactor does not match.
      const message = shortenDiagnostic(this.#redactMcp(raw));
      // An agent that tears down its sessions while OpenBot stops it (idle release, restart, quit)
      // can write an error for each one. It is not a failure the user can act on, so it goes to the log.
      if (origin?.duringStop) {
        stderrLogger.warn("A provider wrote an error while OpenBot stopped it.", {
          provider: client.provider,
          message,
        });
        return;
      }
      const names = new Set([
        ...this.#credentials.mcpServers().map((config) => config.name),
        ...this.#mcpHandoff.names(),
      ]);
      if (isMcpSubsystemDiagnostic(message, [...names])) {
        stderrLogger.warn("A provider reported an MCP server failure.", { provider: client.provider, message });
        return;
      }
      if (isTelemetryExportDiagnostic(message)) {
        stderrLogger.warn("A provider reported a telemetry export failure.", { provider: client.provider, message });
        return;
      }
      if (isToolCallDiagnostic(message)) {
        stderrLogger.warn("A provider reported a failed tool call.", { provider: client.provider, message });
        return;
      }
      if (isBackgroundRefreshDiagnostic(message)) {
        stderrLogger.warn("A provider reported a failed background refresh.", { provider: client.provider, message });
        return;
      }
      if (isAcpHandlerDiagnostic(message)) {
        stderrLogger.warn("A provider logged a request that it answered with an error.", {
          provider: client.provider,
          message,
        });
        return;
      }
      if (isIgnoredConfigDiagnostic(message)) {
        stderrLogger.warn("A provider ignored settings in its configuration.", { provider: client.provider, message });
        return;
      }
      if (isUsageLimitDiagnostic(message)) {
        stderrLogger.warn("A provider reported an exhausted usage limit.", { provider: client.provider, message });
        Effect.runFork(this.refreshUsageAfterLimit(client));
        return;
      }
      if (isGlogBelowErrorDiagnostic(message)) {
        stderrLogger.info("A provider logged an info or warning record.", { provider: client.provider, message });
        return;
      }
      // Without the timestamp, a repeat of one failure is the same message, and the renderer shows
      // it once rather than once per attempt.
      this.#emitProviderError(client.provider, "diagnostic", message.replace(LOG_TIMESTAMP_PREFIX, ""));
    });
    client.on("notification", (notification) => {
      if (notification.method === "configWarning") this.#reportConfigWarning(client, notification.params);
    });
    client.once("exit", (error) => this.#handleExit(client, error));
  }

  /**
   * Codex's report of the settings it ignored, with each key named: the stderr copy of it has only
   * the summary (see `isIgnoredConfigDiagnostic`). The full text, with the path of each file, goes
   * to the log; the user gets the keys, because the renderer does not show paths.
   *
   * Other configuration warnings are not reported here.
   */
  #reportConfigWarning(client: AgentClient, params: unknown): void {
    const summary = getString(params, "summary");
    const ignored = summary ? ignoredCodexSettings(summary) : null;
    if (!summary || !ignored) return;
    const redacted = shortenDiagnostic(this.#redactMcp(summary));
    logger.warn("A provider ignored settings in its configuration.", { provider: client.provider, message: redacted });
    if (this.#reportedConfigWarnings.has(redacted)) return;
    this.#reportedConfigWarnings.add(redacted);
    const message =
      ignored.keys.length > 0
        ? sourceText("error.provider.codexConfigIgnored", { count: ignored.count, settings: ignored.keys.join(", ") })
        : sourceText("error.provider.codexConfigIgnoredUnnamed", { count: ignored.count });
    this.#emitError(`${client.provider}_config_ignored`, message);
  }

  #handleExit(client: AgentClient, error: Error): void {
    if (this.#handleConfinedExit(client, error)) return;
    if (this.#clients.get(client.provider) !== client || this.#hooks.isStopping()) return;
    this.#clients.delete(client.provider);
    Effect.runFork(client.stop().pipe(Effect.ignore, Effect.forkIn(this.#scope)));
    this.#conversation.clearLoadedThreads();
    this.#hooks.onProviderLost(client);
    this.#exitRecovery.add(client.provider);
    this.#emitProviderError(client.provider, "exited", error);
    const providers = updateProviderStatus(this.#status.providers, client.provider, {
      state: "error",
      version: this.#cli.get(client.provider)?.version ?? null,
      message: this.#redactMcp(error.message),
    });
    const anotherProviderIsReady = this.#clients.size > 0 || this.#released.size > 0;
    const attempts = this.#restartAttempts.get(client.provider) ?? 0;

    if (attempts >= 3) {
      this.#setStatus(
        anotherProviderIsReady
          ? {
              phase: "ready",
              providers,
              capabilities: { ...this.#status.capabilities, chat: "ready" },
              message: null,
            }
          : {
              phase: "blocked",
              providers,
              capabilities: { ...this.#status.capabilities, chat: "unavailable" },
              message: `${providerLabel(client.provider)} stopped repeatedly. Restart OpenBot after checking the CLI.`,
            },
      );
      return;
    }

    const delayMs = 500 * 2 ** attempts;
    this.#restartAttempts.set(client.provider, attempts + 1);
    this.#setStatus(
      anotherProviderIsReady
        ? {
            phase: "ready",
            providers,
            capabilities: { ...this.#status.capabilities, chat: "ready" },
            message: null,
          }
        : {
            phase: "restarting",
            providers,
            capabilities: { ...this.#status.capabilities, chat: "unavailable" },
            message: `${providerLabel(client.provider)} stopped. Retrying (${attempts + 1}/3)…`,
          },
    );
    this.#scheduleRestart(client.provider, delayMs);
  }

  /**
   * `afterTimeout`: a retry of a start that timed out runs restart recovery only when no other
   * provider is live, or when this provider exited and its deliveries wait for recovery.
   * `onProvidersReady` settles every unresolved delivery, and would record a turn that another
   * provider still runs as interrupted.
   */
  #scheduleRestart(provider: AgentProvider, delayMs: number, afterTimeout = false): void {
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.set(
      provider,
      setTimeout(() => {
        this.#restartTimers.delete(provider);
        Effect.runFork(this.#restart(provider, afterTimeout).pipe(Effect.forkIn(this.#scope)));
      }, delayMs),
    );
  }

  /** A refresh the user asked for gets new automatic retries, and no retry of the old ones is left. */
  #resetRestarts(provider: AgentProvider): void {
    this.#restartAttempts.delete(provider);
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.delete(provider);
  }

  readonly #restart = Effect.fn("ProviderRuntime.restart")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    afterTimeout = false,
  ) {
    const disposals = this.#disposals;
    // A turn in the backoff may have started the provider already: a second connect would replace
    // that client and leave it running. That start can also end with no client, when the client it
    // added exits before the start ends, so the retry waits for it rather than being dropped.
    for (let pending = this.#providerStarts.get(provider); pending; pending = this.#providerStarts.get(provider)) {
      const currentStart = pending;
      yield* Deferred.await(currentStart).pipe(Effect.ignore);
    }
    if (this.#hooks.isStopping() || disposals !== this.#disposals || this.#clients.has(provider)) return;
    const notifyReady =
      !afterTimeout || this.#exitRecovery.has(provider) || (this.#clients.size === 0 && this.#released.size === 0);
    yield* this.#startProvider(provider, { notifyReady }, "restarting").pipe(
      Effect.catch((failure) => Effect.sync(() => this.#emitProviderError(provider, "restart_failed", failure.cause))),
    );
    recordRestartActivity();
  }, Effect.uninterruptible);

  /**
   * Starts a provider whose CLI did not answer in time again later, with the backoff and the attempt
   * count of `#handleExit`. Answers the status message: whether OpenBot tries again, or the user has to.
   */
  #retryAfterTimeout(provider: AgentProvider, schedule: boolean): string {
    const attempts = this.#restartAttempts.get(provider) ?? 0;
    const retry = schedule && attempts < 3;
    if (retry) {
      this.#restartAttempts.set(provider, attempts + 1);
      this.#scheduleRestart(provider, 5_000 * 2 ** attempts, true);
    }
    return sourceText(retry ? "error.provider.cliTimedOut" : "error.provider.cliTimedOutRefresh", {
      provider: providerLabel(provider),
    });
  }

  /**
   * Reads the catalogue of every connected CLI, and answers which providers replied with a fresh one.
   *
   * A provider that has no client, or whose `model/list` failed or timed out, keeps the models it
   * already had. That is the right catalogue to keep answering with, but it is not proof of what the
   * process now running serves, so its id is absent from the set and no caller may treat it as proof.
   */
  readonly #refreshModelCatalog = Effect.fn("ProviderRuntime.refreshModelCatalog")(function* (this: ProviderRuntime) {
    const errorSerialAtStart = this.#errorSerial;
    const discovered = yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS,
      ({ id: provider }) =>
        Effect.gen({ self: this }, function* () {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#clients.get(provider);
          const signedOut = this.#status.providers?.some(
            (status) => status.id === provider && status.state === "sign-in-required",
          );
          // Do not expose fallback or stale models when OpenCode reports sign-in-required. A client
          // in the map has an account: activation refreshes the catalog before it marks the
          // provider available, so the old status alone does not mean signed out.
          if (provider === "opencode" && signedOut && !client) return { provider, models: [], fresh: false };
          if (!client) return { provider, models: previous, fresh: false };
          // Read once per pass, not per model: a stored key cannot change inside one refresh, and
          // a model is unusable only because OpenBot is what put that key in the environment.
          const hasStoredKey = Boolean(this.#credentials.apiKey(provider));
          const startedAt = performance.now();
          return yield* Effect.gen({ self: this }, function* () {
            const serverModels = new Map<string, ModelListResponse["data"][number]>();
            const cursors = new Set<string>();
            let cursor: string | undefined;
            do {
              const response = yield* client
                .request(
                  "model/list",
                  { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
                  decodeModelListResponse,
                  // A custom agent can need more than 5 s to start and open a probe session in
                  // `initialize` and again in `model/list`: Claude Agent ACP with a few plugins and MCP
                  // servers does. It answers inside the normal timeout, and a list that timed out kept
                  // that agent out of the catalogue.
                  client.provider === "acp" ? this.#requestTimeoutMs : 5_000,
                )
                .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
              // Every model the CLI reports is offered, the ones it marks hidden included; only the
              // stored-key drop below keeps a model out. A CLI hides a model it still accepts -- a new release such
              // as `gpt-6-astra` is hidden until its own launch -- and this app has no way to tell
              // that apart from a model the account cannot use, so a hidden flag was the only
              // reason a working model was missing from the picker while the same CLI ran it
              // happily from a terminal.
              for (const item of response.data) {
                // The trimmed id is what is kept: `isAgentModel` allows no whitespace, so a padded
                // id would fail the contract guard downstream and take the whole list with it.
                const id = item.model?.trim();
                if (!id) continue;
                // An id the contract refuses is dropped alone, for the same reason: the Cursor CLI
                // once added `=` and `,`, and that emptied the picker for every provider.
                if (!isAgentModel(id)) {
                  logger.warn("A provider reported a model id that is not valid.", { provider: client.provider, id });
                  continue;
                }
                serverModels.set(id, { ...item, model: id });
              }
              cursor = client.provider === "codex" ? response.nextCursor : undefined;
              if (cursor && cursors.has(cursor))
                return yield* new ProviderOperationFailed({
                  cause: new Error("Model discovery repeated a pagination cursor."),
                });
              if (cursor) cursors.add(cursor);
            } while (cursor);
            const models: AgentModelOption[] = [];
            for (const server of serverModels.values()) {
              if (!server.model) continue;
              const fallback = MODEL_METADATA_FALLBACKS.find(
                (candidate) => candidate.provider === client.provider && candidate.id === server.model,
              );
              const efforts = (server?.supportedReasoningEfforts ?? [])
                .map((item) => item.reasoningEffort)
                .filter(isReasoningEffort);
              // The name the provider CLI gives, whole: a model is easier to recognise as
              // `GPT-5.6 Sol` than as `Sol`, and its own CLI names it that way.
              // Claude Code is the exception, and `claudeModelName` says why.
              // Clamped, because a name over the limit is not a long name downstream: it fails
              // `isAgentModelOption`, and the IPC and Team API list decoders fail closed on the
              // whole array, so one over-long name empties the picker. OpenCode is the CLI that
              // reaches it - it names a custom model `"<provider name>/<model name>"`, and 80 plus
              // 160 characters passes 160 - but the clamp protects every CLI.
              const name = modelDisplayName(
                (client.provider === "claude" ? claudeModelName(server.model) : null) ||
                  server.displayName?.trim() ||
                  fallback?.name ||
                  server.model,
              );
              // The stored key is an OpenCode Go key, so the Zen models the key also lists never
              // reach the picker. With no key stored the same models can only come from the user's
              // own OpenCode sign-in, which does buy them. Decided here, on the resolved name, so
              // the catalog and the picker's Free badge cannot disagree about what costs money.
              if (provider === "opencode" && hasStoredKey && isOpencodeModelUnusableWithStoredKey(server.model, name)) {
                continue;
              }
              models.push({
                provider: client.provider,
                id: server.model,
                name,
                description:
                  fallback?.description ?? `${providerLabel(client.provider)} model discovered from the local CLI.`,
                defaultReasoningEffort: isReasoningEffort(server?.defaultReasoningEffort)
                  ? server.defaultReasoningEffort
                  : (fallback?.defaultReasoningEffort ?? "medium"),
                supportedReasoningEfforts: efforts.length
                  ? efforts
                  : (fallback?.supportedReasoningEfforts ?? ["medium"]),
              });
            }
            const rank = PREFERRED_MODEL_ORDER.get(client.provider) ?? (() => 0);
            // Tier first, then newest first. Sort is stable, so the CLI's own order still decides
            // between models of one version.
            const sorted = [...models].sort(
              (left, right) => rank(left) - rank(right) || compareModelVersions(left, right),
            );
            // A successful but empty OpenCode response is no more useful to the picker than a
            // timeout: it must not erase the built-in free tier on first discovery. Keep the last
            // known catalog when available, otherwise seed the OpenCode safety net. It is not a
            // fresh catalog, so callers must not treat it as proof that this process serves it.
            // A response that the stored-key filter emptied is a real answer: restoring the last
            // catalog would bring back the models that the key cannot use.
            logger.info("A provider listed its models.", {
              provider,
              count: sorted.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
            if (client.provider === "opencode" && serverModels.size === 0) {
              return { provider, models: modelsAfterOpenCodeDiscoveryFailure(previous), fresh: false };
            }
            return { provider, models: sorted, fresh: true };
          }).pipe(
            Effect.catch((failure) => {
              this.#recordProviderError(provider, failure.cause);
              logger.warn("A provider did not list its models.", {
                provider,
                durationMs: Math.round(performance.now() - startedAt),
                timeout: isProviderTimeout(failure.cause),
              });
              return Effect.succeed({
                provider,
                models: provider === "opencode" ? modelsAfterOpenCodeDiscoveryFailure(previous) : previous,
                fresh: false,
              });
            }),
          );
        }),
      { concurrency: "unbounded" },
    );
    this.#models = discovered.flatMap((entry) => entry.models);
    const fresh = new Set(discovered.filter((entry) => entry.fresh).map((entry) => entry.provider));
    let cleared = false;
    for (const provider of fresh) {
      const lastError = this.#lastErrors.get(provider);
      if (!lastError || lastError.serial > errorSerialAtStart) continue;
      this.#lastErrors.delete(provider);
      cleared = true;
    }
    if (cleared) this.#setStatus({});
    return fresh;
  });

  /** Shows a provider failure to the user and keeps it on the provider row. */
  #emitProviderError(provider: AgentProvider, kind: string, error: unknown, agentId?: string): void {
    this.#recordProviderError(provider, error);
    this.#emitError(`${provider}_${kind}`, error, agentId);
    this.#setStatus({});
  }

  #recordProviderError(provider: AgentProvider, error: unknown): void {
    const message = shortenDiagnostic(
      this.#redactMcp(redactText(error instanceof Error ? error.message : String(error))),
    );
    this.#errorSerial += 1;
    this.#lastErrors.set(provider, { message, at: Date.now(), serial: this.#errorSerial });
    logger.warn("A provider failed.", { provider, message });
  }

  readonly #refreshUsage = Effect.fn("ProviderRuntime.refreshUsage")(function* (
    this: ProviderRuntime,
    client: AgentClient,
    model?: string,
    emit = true,
  ) {
    const rateLimits = yield* client
      .request(
        "account/rateLimits/read",
        client.provider === "codex" ? undefined : { model },
        decodeAccountRateLimitsReadResult,
      )
      .pipe(Effect.mapError((failure) => new ProviderOperationFailed({ cause: failure.cause })));
    const usage = normalizeAccountUsage(rateLimits, client.provider === "codex" ? model : undefined);
    if (emit) this.#emit({ type: "usage-changed", usage: structuredClone(usage) });
    return structuredClone(usage);
  });

  #setStatus(patch: Partial<AgentStatus>): void {
    if (patch.providers) {
      logProviderStateChanges(this.#status.providers ?? [], patch.providers, this.#redactMcp);
      // A provider with no CLI has nothing left to diagnose, and its row already says why: an error
      // from a removed custom agent must not stay under an empty list.
      for (const row of patch.providers) if (row.state === "not-installed") this.#lastErrors.delete(row.id);
    }
    this.#status = {
      ...this.#status,
      ...patch,
      capabilities: patch.capabilities ?? this.#status.capabilities,
    };
    this.#emit({ type: "status", status: this.status() });
  }
}

export class ProviderOperationFailed extends Schema.TaggedError<ProviderOperationFailed>()("ProviderOperationFailed", {
  cause: Schema.Defect(),
}) {}

function providerStep<A>(run: () => A): Effect.Effect<A, ProviderOperationFailed> {
  return Effect.try({ try: run, catch: (cause) => new ProviderOperationFailed({ cause }) });
}
