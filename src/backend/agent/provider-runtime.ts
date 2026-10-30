import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
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
  CustomAgentUsage,
  CustomProviderRestart,
  ProviderCodeLoginStart,
  ProviderUsageResetOutcome,
  ProviderUsageResets,
} from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  accountUsageCoversModel,
  agentProviderDescriptor,
  CUSTOM_AGENT_DEFAULT_MODEL,
  CUSTOM_AGENT_LIMITS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { classifyUserError } from "@openbot/user-errors";
import { Deferred, Effect, Exit, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import { startAcpAuthentication } from "./../acp-sign-in";
import { type AgentClient, AgentProcessExitError, type AgentProvider } from "./../agent-client";
import { CodexAppServerClient } from "./../app-server-client";
import {
  type AgentCliInfo,
  type BundledProviderExecutables,
  CodexCliError,
  cliPathEnvironment,
  cliSpawnTarget,
} from "./../cli";
import { readCursorUsage } from "./../cursor-usage";
import { causeHelpers } from "../effect-boundary";
import { McpHandoffLog } from "./../mcp-handoff-log";
import { providerMcpServerName } from "./../mcp-provider-shapes";
import { openCodeSignInMessage } from "./../opencode-config";
import { readOpenCodeGoUsage } from "./../opencode-usage";
import type { ProcessConfinement } from "../process-confinement";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  CLAUDE_API_KEY_ACCOUNT_TYPE,
  decodeAccountRateLimitsReadResult,
  decodeAccountRateLimitsUpdated,
  decodeAccountReadResult,
  decodeRateLimitResetCreditConsumeResult,
  decodeRecordResponse,
  getString,
} from "./../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import {
  antigravityTemp,
  BUILT_IN_PROVIDER_DRIVERS,
  type ProviderClientContext,
  requireProviderDriver,
  savedCustomAgents,
} from "./../provider-drivers";
import { ProviderTempDiskSpaceError } from "../provider-temp";
import { startProviderTerminalLogin } from "../provider-terminal-login";
import { recordRestartActivity } from "../restart-activity";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { stopProcessTree } from "../windows-process-tree";
import { normalizeAccountUsage, usageWindowHasReset, usageWindowResetSince } from "./account-usage";
import { captureBrowser } from "./browser-capture";
import { startCliCodeLogin } from "./cli-code-login";
import { CliLoginFailed, CliLoginFlow, toCliLoginFailed } from "./cli-login-flow";
import { CodexLoginFlow, toCodexLoginFailed } from "./codex-login";
import type { ConversationRuntime } from "./conversation-runtime";
import { ModelCatalog } from "./model-catalog";
import { startMuseDeviceLogin } from "./muse-login";
import type { ProviderAccountStore, StoredProviderAccount } from "./provider-account-store";
import { defaultUsageModel, ProviderAccountFailed, ProviderAccounts } from "./provider-accounts";
import {
  createAcpRequestEchoReader,
  ignoredCodexSettings,
  isAcpHandlerDiagnostic,
  isBackgroundRefreshDiagnostic,
  isBundledSandboxFallbackDiagnostic,
  isCodexCredentialFallbackDiagnostic,
  isGlogBelowErrorDiagnostic,
  isIgnoredConfigDiagnostic,
  isMcpSubsystemDiagnostic,
  isTelemetryExportDiagnostic,
  isToolCallDiagnostic,
  isUsageLimitDiagnostic,
  isUsageReadDiagnostic,
  LOG_TIMESTAMP_PREFIX,
} from "./provider-diagnostics";
import {
  isProviderTimeout,
  providerFailureStatus,
  setProviderStatus,
  updateProviderStatus,
  waitForSuccessfulProcess,
} from "./provider-status";
import { providerForAgent, providerLabel } from "./thread-items";
import { UsageReadGate } from "./usage-read-gate";
import { checkAgentFolders, workspaceExcludedFolders, workspaceWritableRoots } from "./workspace-sandbox";

const logger = createOpenBotLogger("provider-runtime");
/**
 * Stderr records that the classifiers sort out as noise. They can quote a tool call's output or a
 * command line, so they go to the console only and not to the provider log file.
 */
const stderrLogger = createOpenBotLogger("provider-stderr");

const ACCOUNT_USAGE_READ_TIMEOUT_MS = 30_000;
/** A read this recent answers a second request, such as one that waited for the read before it. */
const CUSTOM_AGENT_USAGE_REUSE_MS = 60_000;
/** A released `acp` shows its last answers for this long, then starts again to read new ones. */
const CUSTOM_AGENT_USAGE_WAKE_MS = 60 * 60_000;
/** The providers whose app server spends a usage reset credit (`account/rateLimitResetCredit/consume`). */
const USAGE_RESET_PROVIDERS: ReadonlySet<AgentProvider> = new Set(["codex"]);
/**
 * How long a start may take when it holds back no other provider: the first start of a CLI that was
 * just installed, a start that follows a sign-in or a key change, and each start of a provider that
 * did not finish a start in the request timeout. The Windows Gemini server unpacks about 310 MB at
 * every start, and an antivirus scan of the unpacked files can take minutes on a slow computer
 * (#1275, #2311). The Intel macOS server unpacks at every start too, for more than this (#3532), so
 * each start that does not answer in time waits twice as long as the one before. A start in the
 * request timeout stopped it while it unpacked, and the next start unpacked again. A launch keeps
 * the request timeout: it waits for every provider, and one CLI that hangs would hold chat back for
 * all of them.
 */
const LONG_START_TIMEOUT_MS = 180_000;
/** How long a provider CLI stays running with nothing to do before its process is stopped. */
const PROVIDER_IDLE_RELEASE_MS = 10 * 60_000;
/**
 * The same for a provider no agent is set to. Every signed-in provider starts at launch to read its
 * models, and an unused OpenCode process alone held about 300 MB for the full idle time.
 */
const PROVIDER_UNASSIGNED_RELEASE_MS = 60_000;
const PROVIDER_IDLE_CHECK_MS = 60_000;
/** How often the host reads a signed-out provider's sign-in file. A read is one `stat`. */
const SIGN_IN_FILE_POLL_MS = 2_000;

/**
 * Identifies one write of a sign-in file. The time alone is not enough: a file system with 1 s
 * times shows two writes in the same second as one, such as an empty file and then the credentials.
 */
function signInFileVersion(path: string): string {
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    return stats ? `${stats.ino}:${stats.size}:${stats.mtimeMs}` : "missing";
  } catch {
    return "unreadable";
  }
}
/**
 * Starts that fail in a row before OpenBot stops starting a provider by itself. A start that fails,
 * that times out, or whose process ends within `STABLE_RUN_MS` counts. Only a user action starts the
 * provider again: each start of the Windows Gemini server unpacks about 310 MB, and a loop of starts
 * filled the disk.
 */
const START_FAILURE_LIMIT = 3;
const STABLE_RUN_MS = 2 * 60_000;
/** How often a restart the user asked for checks whether the provider's turns have ended. */
const PROVIDER_RESTART_POLL_MS = 1_000;
/** The start failure of OpenCode 1 on a database that OpenCode 2 made. */
const OPENCODE_NEWER_DATABASE = /\bDatabase is not empty and has no session table\b/u;
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

/**
 * One log line for each row whose state or connection state changes, so the provider log shows when a
 * provider went away, and when a connect started and ended.
 */
function logProviderStateChanges(
  previous: readonly AgentProviderStatus[],
  next: readonly AgentProviderStatus[],
  redactMcp: (text: string) => string,
): void {
  for (const row of next) {
    const before = previous.find((candidate) => candidate.id === row.id);
    if (before?.state === row.state && before?.connectionState === row.connectionState) continue;
    logger.info("A provider changed state.", {
      provider: row.id,
      from: before?.state ?? null,
      to: row.state,
      connectionState: row.connectionState ?? null,
      version: row.version,
      message: row.message === null ? null : shortenDiagnostic(redactMcp(row.message)),
    });
  }
}

/**
 * The windows of a pushed rate-limit update for the provider's own bucket, or null when the push is for another
 * bucket, such as a Codex model-specific one, or cannot be read.
 */
function pushedUsageLimit(provider: AgentProvider, params: unknown): AccountUsage["limits"][number] | null {
  let rateLimits: ReturnType<typeof decodeAccountRateLimitsUpdated>;
  try {
    rateLimits = decodeAccountRateLimitsUpdated(params);
  } catch {
    return null;
  }
  if ((rateLimits.limitId ?? provider) !== provider) return null;
  const limit = normalizeAccountUsage({ rateLimits, rateLimitsByLimitId: null }).limits[0];
  return limit && (limit.primary || limit.secondary) ? limit : null;
}

export type AgentClientFactory = (
  provider: AgentProvider,
  cli: AgentCliInfo,
  confinement?: ProcessConfinement,
  accountEnvironment?: Readonly<Record<string, string>>,
) => AgentClient;

/**
 * Why an agent needs a process of its own: a Workspace only agent on a provider that confines a
 * whole process, an agent on a provider account after the first, or both.
 */
interface OwnProcess {
  readonly confinement?: ProcessConfinement;
  readonly account?: StoredProviderAccount;
}

/**
 * The own process of one Workspace only agent on a provider that confines a whole process. `key`
 * names what the process was started with, so a changed workspace, CLI or provider process
 * starts a new one before the next turn.
 */
interface ConfinedClient {
  readonly client: AgentClient;
  readonly key: string;
  /** The provider account it signed in to, or null for the provider's own sign-in. */
  readonly accountId: string | null;
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
  providers: AGENT_PROVIDERS.map((id) => ({ id, state: "not-started", version: null, message: null })),
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
  /** `LONG_START_TIMEOUT_MS`, shorter in an end-to-end script. */
  readonly #longStartTimeoutMs: number;
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
  #removingCustomRuntime = false;
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
  /**
   * Managed runtime updates that wait for the provider's turns to end. The provider is held as
   * `isReplacingCli` meanwhile, so new turns do not keep the update waiting.
   */
  readonly #updatesWhenIdle = new Set<AgentProvider>();
  /** A custom agent change that a turn delayed. The idle check applies it when the turn stops. */
  #customAgentsReloadPending = false;
  /**
   * Providers that a turn kept on the old agent environment or OpenCode config. The idle check
   * restarts each after its turn.
   */
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
   * The usage reset credits that the last usage reading of each client counted, null when the
   * provider could not count them. A provider that has no credits never sets one.
   */
  readonly #resetCredits = new WeakMap<AgentClient, number | null>();
  /** The same count for each provider's own sign-in, kept for a released provider as `#lastUsage` is. */
  readonly #ownResetCredits = new Map<AgentProvider, number | null>();
  /**
   * Providers whose last usage read returned no limit, such as custom ACP agents. The dock polls
   * every five minutes, so starting a released one to ask again would keep its process running.
   */
  readonly #usageUnreported = new Set<AgentProvider>();
  /** Paces the usage reads of each provider's own sign-in. A new login or credential resets it. */
  readonly #usageGates = new Map<AgentProvider, UsageReadGate>();
  /**
   * The last answer of each custom agent's usage prompt, with the prompt and the time of the read. A
   * null text is a read that gave no answer, kept so that a released `acp` does not start for it again.
   */
  readonly #customAgentUsage = new Map<string, { prompt: string; text: string | null; readAt: number }>();
  /** One usage read at a time, so that a second request does not send the prompts again. */
  readonly #customAgentUsageLock = Semaphore.makeUnsafe(1);
  #idleCheck: NodeJS.Timeout | null = null;
  /** Each provider's sign-in file, and the version of it that the last account check saw. */
  readonly #signInFiles = new Map<AgentProvider, { path: string; seen: string }>();
  #signInCheck: NodeJS.Timeout | null = null;
  #status: AgentStatus = structuredClone(INITIAL_STATUS);
  #providerRefresh: Deferred.Deferred<AgentStatus, ProviderOperationFailed> | null = null;
  readonly #codexLogin: CodexLoginFlow;
  readonly #cliLogin: CliLoginFlow;
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
  /** Starts in a row that failed (`START_FAILURE_LIMIT`). A user action clears them. */
  readonly #startFailures = new Map<AgentProvider, number>();
  /** Providers that did not answer `initialize` in time, and how long their next start waits (`#countSlowStart`). */
  readonly #slowStarts = new Map<AgentProvider, number>();
  /** When each provider's current client became its client. */
  readonly #activatedAt = new Map<AgentProvider, number>();
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
  readonly #modelCatalog: ModelCatalog;
  readonly #off: Set<AgentProvider>;
  readonly #saveProviderUse: (provider: AgentProvider, on: boolean) => Effect.Effect<void, ProviderOperationFailed>;
  /** Null without a store, as in tests: each provider then holds its own sign-in only. */
  readonly #providerAccounts: ProviderAccounts | null;

  constructor(options: {
    offProviders?: readonly AgentProvider[];
    saveProviderUse?: (provider: AgentProvider, on: boolean) => Effect.Effect<void, ProviderOperationFailed>;
    conversation: ConversationRuntime;
    hooks: ProviderHooks;
    emit: (event: AgentEvent) => void;
    emitError: (code: string, error: unknown, agentId?: string) => void;
    requestTimeoutMs: number;
    longStartTimeoutMs?: number;
    preferredProvider: AgentProvider;
    preferredModel?: AgentModelId | null;
    clientFactory: AgentClientFactory | null;
    bundledExecutables: BundledProviderExecutables;
    credentials: ProviderClientContext;
    mcpHandoff?: McpHandoffLog;
    redactMcp: (text: string) => string;
    accounts?: ProviderAccountStore;
  }) {
    this.#off = new Set(options.offProviders);
    this.#saveProviderUse = options.saveProviderUse ?? (() => Effect.void);
    this.#conversation = options.conversation;
    this.#hooks = options.hooks;
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#longStartTimeoutMs = options.longStartTimeoutMs ?? LONG_START_TIMEOUT_MS;
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
          : new CodexAppServerClient(cli.executable, this.#requestTimeoutMs, cliPathEnvironment(cli));
        this.#bindClient(client);
        return client;
      },
      hasActiveClient: (client) => (client ? this.#clients.get("codex") === client : this.#clients.has("codex")),
      activate: (client, cli, account, activateOptions) =>
        this.#activateProviderClient("codex", client, cli, account, activateOptions).pipe(toCodexLoginFailed),
      setConnecting: () => this.#setProviderConnectionState("codex", "connecting", true),
      isConnecting: () =>
        this.#status.providers?.find((provider) => provider.id === "codex")?.connectionState === "connecting",
      clearConnectionState: () => this.#clearProviderConnectionState("codex"),
      setFailure: (error, version) => this.#setProviderConnectionFailure("codex", error, version),
    });
    this.#cliLogin = new CliLoginFlow({
      scope: () => this.#scope,
      resolveCli: (provider) => this.#resolveProviderCli(provider).pipe(toCliLoginFailed),
      authenticate: (provider, cli) =>
        this.#authenticateClient(provider, cli, { startTimeoutMs: this.#longStartWaitMs(provider) }).pipe(
          toCliLoginFailed,
        ),
      activate: (provider, client, cli, account, activateOptions) =>
        this.#activateProviderClient(provider, client, cli, account, activateOptions).pipe(toCliLoginFailed),
      setConnecting: (provider) => this.#setProviderConnectionState(provider, "connecting", true),
      clearConnectionState: (provider) => this.#clearProviderConnectionState(provider),
      setFailure: (provider, error, version) => this.#setProviderConnectionFailure(provider, error, version),
    });
    this.#providerAccounts = options.accounts
      ? new ProviderAccounts(options.accounts, {
          scope: () => this.#scope,
          cli: (provider) =>
            this.#clients.has(provider) || this.#released.has(provider) ? this.#cli.get(provider) : undefined,
          defaultEmail: (provider) => this.#accounts.get(provider)?.email ?? null,
          apiKey: (provider) => this.#credentials.apiKey(provider),
          defaultUsesApiKey: (provider) => this.ownSignInUsesKey(provider),
          signInTemp: (provider) => {
            const temp = provider === "antigravity" ? antigravityTemp(this.#credentials) : undefined;
            return temp && { ...temp, provider: providerLabel(provider) };
          },
          // The sign-in process waits for a slow start, so the check after it waits as long (#3546).
          // A cancel or a removal must not wait for that start: the accounts start it uninterruptibly.
          authenticate: (provider, cli, accountEnvironment, afterSignIn) =>
            this.#authenticateClient(provider, cli, {
              accountEnvironment,
              interruptibleStart: true,
              ...(afterSignIn ? { startTimeoutMs: this.#longStartWaitMs(provider) } : {}),
            }).pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause }))),
          stopClient: (client) =>
            Effect.gen({ self: this }, function* () {
              yield* client.stop().pipe(Effect.ignore);
              yield* this.#hooks.onClientStopped(client).pipe(Effect.ignore);
            }),
          agentClient: (provider, accountId) =>
            [...this.#confined.values()].find(
              (confined) => confined.client.provider === provider && confined.accountId === accountId,
            )?.client ?? null,
          isAccountBusy: (provider, accountId) =>
            [...this.#confined].some(
              ([agentId, confined]) =>
                confined.client.provider === provider &&
                confined.accountId === accountId &&
                this.#hooks.isAgentBusy(agentId),
            ),
          stopAgentClients: (provider, accountId) =>
            Effect.forEach(
              [...this.#confined].filter(
                ([, confined]) => confined.client.provider === provider && confined.accountId === accountId,
              ),
              ([agentId, confined]) => this.#stopConfined(agentId, confined).pipe(Effect.ignore),
              { concurrency: "unbounded", discard: true },
            ),
          readUsage: (client, model) =>
            this.#refreshUsage(client, model, false).pipe(
              Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })),
            ),
          resetCredits: (client) => this.#resetCredits.get(client),
          consumeUsageReset: (client) =>
            this.#consumeUsageReset(client).pipe(
              Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })),
            ),
          changed: () => this.#setStatus({}),
          usageChanged: (limit) => this.#emit({ type: "usage-changed", usage: { limits: [structuredClone(limit)] } }),
          redact: (text) => this.#redactMcp(redactText(text)),
        })
      : null;
    this.#modelCatalog = new ModelCatalog({
      client: (provider) => (this.#off.has(provider) ? undefined : this.#clients.get(provider)),
      isSignedOut: (provider) =>
        this.#status.providers?.some((status) => status.id === provider && status.state === "sign-in-required") ??
        false,
      credentials: this.#credentials,
      requestTimeoutMs: this.#requestTimeoutMs,
      recordProviderError: (provider, error) => this.#recordProviderError(provider, error),
    });
  }

  /** The account type and plan of the provider's own sign-in, or `null` before it is read. */
  accountKind(provider: AgentProvider): { type: string; planType: string | null } | null {
    const account = this.#accounts.get(provider);
    return account ? { type: account.type, planType: account.planType ?? null } : null;
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
        if (this.#off.has(row.id)) return { id: row.id, state: "not-started", version: null, message: null, off: true };
        const source = this.#cli.get(row.id)?.source ?? this.#cliSources.get(row.id);
        const lastError = this.#lastErrors.get(row.id);
        const unverified =
          row.id === "muse" && row.state === "available" && this.#accounts.get(row.id)?.type === "muse-unverified";
        const withSource = {
          ...row,
          ...(unverified
            ? { state: "sign-in-required" as const, message: sourceText("error.provider.museAuthUnverified") }
            : {}),
          ...(source ? { cliSource: source } : {}),
          ...(lastError ? { lastError: lastError.message, lastErrorAt: lastError.at } : {}),
          ...(row.id === "antigravity" && this.#credentials.apiKey("antigravity") ? { apiKeyInUse: true } : {}),
          ...(row.id === "codex" && this.#accounts.get("codex")?.type === "apiKey" ? { apiKeyInUse: true } : {}),
        };
        const accounts =
          row.state === "available" && row.id !== "acp"
            ? this.#providerAccounts?.rows(row.id, row.email ?? null)
            : undefined;
        const withAccounts = accounts ? { ...withSource, accounts } : withSource;
        return this.#restartsWhenIdle.has(row.id) ? { ...withAccounts, restartPending: true } : withAccounts;
      }),
    };
  }

  /** The failure the provider row shows, or null after a good model list. */
  lastError(provider: AgentProvider): string | null {
    return this.#lastErrors.get(provider)?.message ?? null;
  }

  requireProviderOn(provider: AgentProvider): void {
    if (this.#off.has(provider))
      throw new Error(sourceText("error.provider.off", { provider: providerLabel(provider) }));
  }

  /** The service holds the agent-assignment lock while it switches a provider off. */
  readonly setProviderOn = Effect.fn("ProviderRuntime.setProviderOn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    on: boolean,
  ) {
    if (provider === "acp")
      return yield* new ProviderOperationFailed({ cause: new Error("Invalid built-in provider.") });
    if (on === !this.#off.has(provider)) return this.status();
    if (!on) {
      if (this.#hooks.isProviderAssigned(provider) || this.#hooks.isProviderBusy(provider))
        return yield* new ProviderOperationFailed({
          cause: new Error(sourceText("error.provider.inUse", { provider: providerLabel(provider) })),
        });
      if (
        this.#providerRefresh ||
        this.#providerStarts.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        this.#status.providers?.some((row) => row.id === provider && row.state === "checking") ||
        (provider === "codex" && this.#codexLogin.pending) ||
        this.#cliLogin.has(provider)
      )
        return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.useBusy")) });
      // Block new starts before the file write yields. A failed write restores the old state.
      this.#off.add(provider);
    }
    yield* this.#saveProviderUse(provider, on).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (!on) this.#off.delete(provider);
          this.#setStatus({});
        }),
      ),
    );
    if (on) {
      this.#off.delete(provider);
      yield* this.refreshProvider(provider);
    } else {
      this.#resetRestarts(provider);
      this.#startFailures.delete(provider);
      this.cancelProviderRestart(provider);
      this.#released.delete(provider);
      this.#exitRecovery.delete(provider);
      this.#lastErrors.delete(provider);
      yield* this.#stopProviderClient(provider);
      this.#cli.delete(provider);
      this.#accounts.delete(provider);
      this.#forgetUsage(provider);
      this.#setStatus({
        providers: updateProviderStatus(this.#status.providers, provider, {
          state: "not-started",
          version: null,
          message: null,
        }),
      });
      const remaining = [...this.#clients.keys(), ...this.#released];
      const primary = remaining.includes(this.#preferredProvider) ? this.#preferredProvider : remaining[0];
      this.#setStatus({
        phase: primary ? "ready" : "blocked",
        cliVersion: primary ? (this.#status.providers?.find((row) => row.id === primary)?.version ?? null) : null,
        auth: primary
          ? requireProviderDriver(primary).authState(this.#accounts.get(primary) ?? null)
          : { kind: "unknown" },
        message: null,
        capabilities: { ...this.#status.capabilities, chat: primary ? "ready" : "unavailable" },
      });
    }
    return this.status();
  }, Effect.uninterruptible).bind(this);

  /** Resolve a provider's binary and keep who owns it, whether or not the provider is signed in. */
  readonly #resolveProviderCli = Effect.fn("ProviderRuntime.resolveCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    return yield* Effect.gen({ self: this }, function* () {
      yield* providerStep(() => this.requireProviderOn(provider));
      if (provider === "acp" && savedCustomAgents(this.#credentials).length === 0) {
        return yield* new ProviderOperationFailed({
          cause: new CodexCliError(sourceText("error.provider.customAgentNone"), "missing"),
        });
      }
      const driver = requireProviderDriver(provider);
      const bundledExecutable = this.#bundledExecutables[driver.cliProvider ?? provider];
      const cli = yield* driver
        .resolveCli(bundledExecutable === undefined ? {} : { bundledExecutable })
        .pipe(toProviderOperationFailed);
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
      this.#cliLogin.size +
      this.#providerStarts.size +
      this.#providerConnectionCommands.size +
      this.#replacingCli.size +
      this.#restartsWhenIdle.size +
      this.#updatesWhenIdle.size +
      (this.#codexLogin.pending ? 1 : 0)
    );
  }

  /** The provider's main client, without counting a use, so the idle release still applies. */
  currentClient(provider: AgentProvider): AgentClient | null {
    return this.#clients.get(provider) ?? null;
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
      // ACP can hold sessions that exist only in a live process. Its client vetoes stopping while
      // one of those sessions is held; a later turn must not start a new provider context.
      if (client.canReleaseProcess?.() === false) {
        this.#lastUsed.set(provider, now);
        continue;
      }
      if (
        this.#hooks.isProviderBusy(provider) ||
        this.#providerStarts.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        this.isReplacingCli(provider) ||
        this.#cliLogin.has(provider) ||
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
      this.#startFailures.delete(provider);
      this.#conversation.unloadClientThreads(client);
      logger.info("Stopped an idle provider CLI.", { provider });
      yield* client.stop().pipe(toProviderOperationFailed).pipe(Effect.ignore);
      yield* this.#hooks.onClientStopped(client);
    }
    for (const [agentId, confined] of this.#confined) {
      if (confined.client.canReleaseProcess?.() === false) {
        confined.lastUsed = now;
        continue;
      }
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
    return this.#modelCatalog.list().filter((model) => !this.#off.has(model.provider));
  }

  /**
   * A client for one generation without tools. With `accountId`, it signs in as that provider account,
   * as the agent's own process does, so the generation does not spend the limit of the provider's own sign-in.
   */
  createProfileClient(provider: AgentProvider, accountId?: string): AgentClient {
    this.requireProviderOn(provider);
    if (provider === "acp" && this.#removingCustomRuntime)
      throw new Error(sourceText("error.provider.registryRemoveBusy"));
    const cli = this.#cli.get(provider);
    if (!cli || !this.#clients.has(provider)) throw new Error(sourceText("error.provider.connectBeforeProfile"));
    const account = this.#providerAccounts?.account(provider, accountId) ?? null;
    // A CLI that ignores the account's folder would run the generation on the provider's own sign-in.
    if (account && !this.#providerAccounts?.supported(provider))
      throw new Error(sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) }));
    const accountEnvironment = account ? this.#providerAccounts?.environment(account) : undefined;
    if (this.#clientFactory) return this.#clientFactory(provider, cli, undefined, accountEnvironment);
    const context = accountEnvironment ? { ...this.#credentials, accountEnvironment } : this.#credentials;
    const driver = requireProviderDriver(provider);
    if (driver.createProfileClient) return driver.createProfileClient(cli, this.#requestTimeoutMs, context);
    return driver.createClient(cli, this.#requestTimeoutMs, context);
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
    scope?: { provider: AgentProvider; model: string; accountId?: string },
  ) {
    const deadline = Effect.timeoutOrElse({
      duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
      orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
    });
    if (!scope) {
      const statuses = (this.status().providers ?? []).filter(
        (item) => isAgentProvider(item.id) && !item.off && item.connectionState !== "connecting",
      );
      // The default sign-in and the extra accounts are read apart: a provider whose own sign-in has
      // no reading can still have extra accounts that report one.
      const available = new Set(statuses.filter((item) => item.state === "available").map((item) => item.id));
      const providers = statuses
        .map((item) => item.id)
        .filter(isAgentProvider)
        .filter((provider) => available.has(provider) || ProviderAccounts.support(provider))
        .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder);
      // By provider, then by provider and account: the provider's own sign-in comes first.
      const collected = new Map<string, AccountUsage["limits"][number]>();
      const logFailure = (provider: AgentProvider) => this.#logUsageFailure(provider);
      /**
       * The provider's last reading, also with a window that has reset, as an account after the first keeps
       * it: a window that resets after the read starts a read, and the row must not leave the rail between.
       */
      const keptReading = (provider: AgentProvider) =>
        this.#usageUnreported.has(provider) ? null : (this.#lastUsage.get(provider) ?? null);
      const readOwn = (provider: AgentProvider) =>
        Effect.gen({ self: this }, function* () {
          let usage: AccountUsage;
          if (provider === "opencode") {
            // The Go quota is one HTTPS request with the CLI's key, so do not start OpenCode for it.
            usage = normalizeAccountUsage(
              yield* readOpenCodeGoUsage(this.#credentials.apiKey("opencode")).pipe(
                toProviderOperationFailed,
                deadline,
              ),
            );
          } else if (provider === "cursor") {
            // Cursor's usage is two HTTPS requests with the CLI's token, so do not start the CLI for it.
            usage = normalizeAccountUsage(yield* readCursorUsage().pipe(toProviderOperationFailed, deadline));
          } else {
            // Starting a provider that has no usage reading only to get nothing back cost a cold
            // start on every dock poll.
            if (!agentProviderDescriptor(provider).reportsUsage) return null;
            // A Codex API-key login has no plan usage: Codex refuses the read.
            if (provider === "codex" && this.#accounts.get(provider)?.type === "apiKey") return null;
            const kept = this.#released.has(provider) ? this.#lastUsage.get(provider) : undefined;
            if (kept && !usageWindowHasReset(kept)) return kept;
            if (this.#released.has(provider) && this.#usageUnreported.has(provider)) return null;
            if (!this.#clients.has(provider)) yield* this.ensureProvider(provider);
            const client = this.#clients.get(provider);
            if (!client) return null;
            usage = yield* this.#refreshUsage(client, defaultUsageModel(provider), false).pipe(deadline);
          }
          const limit = usage.limits[0];
          if (!limit || (!limit.primary && !limit.secondary)) {
            this.#usageUnreported.add(provider);
            return null;
          }
          this.#keepUsage(provider, usage);
          return { ...limit, id: provider };
        });
      const readDefault = (provider: AgentProvider) =>
        Effect.gen({ self: this }, function* () {
          // Each desktop window, web tab and phone polls, so the gate decides when the provider is asked
          // again. A failed read is logged and keeps the last reading on the rail.
          const limit = yield* this.#usageGate(provider)
            .run({
              read: readOwn(provider),
              kept: () => keptReading(provider),
              stale: (readAt) => {
                const kept = this.#lastUsage.get(provider);
                return kept !== undefined && usageWindowResetSince(kept, readAt);
              },
            })
            .pipe(
              Effect.catch((error) =>
                Effect.fail(error).pipe(this.#logUsageFailure(provider), Effect.as(keptReading(provider))),
              ),
            );
          if (!limit) return;
          collected.set(provider, limit);
          this.#emit({
            type: "usage-changed",
            usage: { limits: [...collected.values()] },
          });
        });
      const readAccounts = (provider: AgentProvider) =>
        Effect.gen({ self: this }, function* () {
          const accountLimits = yield* this.#accountLimits(provider);
          if (accountLimits.length === 0) return;
          for (const accountLimit of accountLimits)
            collected.set(`${provider}:${accountLimit.accountId ?? ""}`, accountLimit);
          this.#emit({ type: "usage-changed", usage: { limits: [...collected.values()] } });
        });
      yield* Effect.forEach(
        providers,
        (provider) =>
          Effect.gen(function* () {
            if (available.has(provider)) yield* readDefault(provider).pipe(logFailure(provider));
            yield* readAccounts(provider).pipe(logFailure(provider));
          }),
        { concurrency: "unbounded", discard: true },
      );
      return { limits: structuredClone([...collected.values()]) };
    }
    if (!accountUsageCoversModel(scope.provider, scope.model)) return { limits: [] };
    const account = this.#providerAccounts?.account(scope.provider, scope.accountId);
    if (account && this.#providerAccounts)
      return yield* this.#providerAccounts
        .usageFor(scope.provider, account.id, scope.model)
        .pipe(toProviderOperationFailed);
    const client = this.#clients.get(scope.provider);
    if (!client) return { limits: [] };
    return yield* this.#refreshUsage(client, scope.model, false);
  }).bind(this);

  /**
   * Only the readings of the accounts after the first, for `provider-accounts-v1`. No provider's own
   * sign-in is read or started, and no `usage-changed` is sent.
   */
  readonly accountUsage = Effect.fn("ProviderRuntime.accountUsage")(function* (this: ProviderRuntime) {
    const providers = (this.status().providers ?? [])
      .filter((item) => !item.off && item.connectionState !== "connecting")
      .map((item) => item.id)
      .filter(isAgentProvider)
      .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder);
    const limits = yield* Effect.forEach(
      providers,
      (provider) =>
        this.#accountLimits(provider).pipe(
          this.#logUsageFailure(provider),
          Effect.map((read) => read ?? []),
        ),
      { concurrency: "unbounded" },
    );
    return { limits: limits.flat() };
  }).bind(this);

  /** The readings of a provider's accounts after the first. Empty for a provider that has none. */
  #accountLimits(provider: AgentProvider) {
    if (
      !this.#providerAccounts ||
      !ProviderAccounts.support(provider) ||
      !agentProviderDescriptor(provider).reportsUsage
    )
      return Effect.succeed([]);
    return this.#providerAccounts.usage(provider, defaultUsageModel(provider)).pipe(
      Effect.timeoutOrElse({
        duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
        orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
      }),
    );
  }

  /**
   * The usage reset credits of each connected account of a provider. The provider's own sign-in is
   * read again while its process runs and keeps its last count while the provider is released; an
   * account after the first is read as the dock reads it. An account whose provider could not count
   * its credits is left out.
   */
  readonly usageResets = Effect.fn("ProviderRuntime.usageResets")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const resets: ProviderUsageResets[] = [];
    if (!USAGE_RESET_PROVIDERS.has(provider) || this.#off.has(provider)) return resets;
    const client = this.#clients.get(provider);
    if (client)
      yield* this.#refreshUsage(client, defaultUsageModel(provider), false).pipe(
        Effect.timeoutOrElse({
          duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
          orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
        }),
        this.#logUsageFailure(provider),
      );
    const own = this.#ownResetCredits.get(provider);
    if (typeof own === "number") resets.push({ provider, accountId: DEFAULT_PROVIDER_ACCOUNT_ID, available: own });
    if (this.#providerAccounts && ProviderAccounts.support(provider))
      resets.push(...(yield* this.#providerAccounts.usageResets(provider, defaultUsageModel(provider))));
    return resets;
  }).bind(this);

  /**
   * Spends one usage reset credit of an account. The account's usage is read again and sent, so
   * every view shows the limits that the provider now reports. The service ends the limit that held
   * the account's agents.
   */
  readonly resetUsage = Effect.fn("ProviderRuntime.resetUsage")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string,
  ) {
    if (!USAGE_RESET_PROVIDERS.has(provider))
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.usageResetUnsupported", { provider: providerLabel(provider) })),
      });
    yield* providerStep(() => this.requireProviderOn(provider));
    if (accountId !== DEFAULT_PROVIDER_ACCOUNT_ID) {
      const accounts = yield* this.#requireAccounts(provider);
      const { outcome, limit } = yield* accounts
        .resetUsage(provider, accountId, defaultUsageModel(provider))
        .pipe(toProviderOperationFailed);
      if (limit) this.#emit({ type: "usage-changed", usage: { limits: [structuredClone(limit)] } });
      return outcome;
    }
    if (!this.#clients.has(provider)) yield* this.ensureProvider(provider);
    const client = this.#clients.get(provider);
    if (!client)
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.accountNeedsConnection", { provider: providerLabel(provider) })),
      });
    const outcome: ProviderUsageResetOutcome = yield* this.#consumeUsageReset(client);
    const usage = yield* this.#refreshUsage(client, defaultUsageModel(provider), false).pipe(
      this.#logUsageFailure(provider),
    );
    const limit = usage ? usage.limits[0] : undefined;
    if (limit && (limit.primary || limit.secondary)) {
      const own = { ...limit, id: provider };
      this.#lastUsage.set(provider, own);
      this.#emit({ type: "usage-changed", usage: { limits: [structuredClone(own)] } });
    }
    return outcome;
  }).bind(this);

  /** A new key for each reset that the user asks for, which the provider spends at most one credit for. */
  #consumeUsageReset(client: AgentClient) {
    return client
      .request(
        "account/rateLimitResetCredit/consume",
        { idempotencyKey: randomUUID() },
        decodeRateLimitResetCreditConsumeResult,
      )
      .pipe(toProviderOperationFailed);
  }

  /**
   * The answers of the custom agents to their usage prompts, for the rail. The answer is text, not
   * windows, so the provider `acp` keeps `reportsUsage: false` and its limit errors stay turn errors.
   * The rail polls every five minutes. A released `acp` shows the last answers, and starts again only
   * when an answer is older than an hour or its prompt changed. An agent with no answer is left out.
   */
  readonly customAgentUsage = Effect.fn("ProviderRuntime.customAgentUsage")(function* (
    this: ProviderRuntime,
  ): Effect.fn.Return<CustomAgentUsage[]> {
    return yield* this.#customAgentUsageLock.withPermit(this.#readCustomAgentUsage());
  }).bind(this);

  readonly #readCustomAgentUsage = Effect.fn("ProviderRuntime.readCustomAgentUsage")(function* (
    this: ProviderRuntime,
  ): Effect.fn.Return<CustomAgentUsage[]> {
    const agents = savedCustomAgents(this.#credentials).flatMap((agent) =>
      agent.usagePrompt === null ? [] : [{ id: agent.id, prompt: agent.usagePrompt }],
    );
    for (const id of this.#customAgentUsage.keys())
      if (!agents.some((agent) => agent.id === id)) this.#customAgentUsage.delete(id);
    if (agents.length === 0 || this.#off.has("acp")) return [];
    const kept = (): CustomAgentUsage[] =>
      agents.flatMap(({ id }) => {
        const text = this.#customAgentUsage.get(id)?.text;
        return text == null ? [] : [{ id, text }];
      });
    const readWithin = (ms: number) =>
      agents.every(({ id, prompt }) => {
        const entry = this.#customAgentUsage.get(id);
        return entry !== undefined && entry.prompt === prompt && Date.now() - entry.readAt < ms;
      });
    if (readWithin(CUSTOM_AGENT_USAGE_REUSE_MS)) return kept();
    if (this.#released.has("acp") && readWithin(CUSTOM_AGENT_USAGE_WAKE_MS)) return kept();
    if (!this.#clients.has("acp")) yield* this.ensureProvider("acp").pipe(this.#logUsageFailure("acp"));
    const client = this.#clients.get("acp");
    const readUsageText = client?.readUsageText?.bind(client);
    if (!readUsageText) return kept();
    yield* Effect.forEach(
      agents,
      ({ id, prompt }) =>
        readUsageText(`${id}/${CUSTOM_AGENT_DEFAULT_MODEL}`, prompt).pipe(
          toProviderOperationFailed,
          Effect.timeoutOrElse({
            duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
            orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
          }),
          Effect.map((answer) => answer?.slice(0, CUSTOM_AGENT_LIMITS.usageAnswer) ?? null),
          Effect.catch((error: ProviderOperationFailed) =>
            Effect.sync(() => {
              logger.warn("Could not read custom agent usage.", {
                provider: "acp",
                message: error.cause instanceof Error ? this.#redactMcp(error.cause.message) : "unknown",
              });
              // A failed read keeps the last answer to the same prompt on the rail.
              const previous = this.#customAgentUsage.get(id);
              return previous?.prompt === prompt ? previous.text : null;
            }),
          ),
          Effect.tap((text) =>
            Effect.sync(() => {
              this.#customAgentUsage.set(id, { prompt, text, readAt: Date.now() });
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );
    return kept();
  });

  /**
   * Keeps a reading of the provider's own sign-in that another read took, such as when Codex starts, so
   * the reading that the gate answers with is not older than the one the views were sent.
   */
  #keepUsage(provider: AgentProvider, usage: AccountUsage): void {
    const limit = usage.limits[0];
    if (!limit || (!limit.primary && !limit.secondary)) return;
    this.#usageUnreported.delete(provider);
    this.#lastUsage.set(provider, { ...limit, id: provider });
  }

  /**
   * Another login or credential: the next poll reads at once, and no view shows the old login's reading or
   * credits, also when that read fails.
   */
  #forgetUsage(provider: AgentProvider): void {
    this.#usageGate(provider).reset();
    this.#lastUsage.delete(provider);
    this.#ownResetCredits.delete(provider);
  }

  #usageGate(provider: AgentProvider): UsageReadGate {
    let gate = this.#usageGates.get(provider);
    if (!gate) {
      gate = new UsageReadGate();
      this.#usageGates.set(provider, gate);
    }
    return gate;
  }

  #logUsageFailure(provider: AgentProvider) {
    return Effect.catch((error: ProviderOperationFailed | ProviderAccountFailed) =>
      Effect.sync(() => {
        logger.warn("Could not read provider usage.", {
          provider,
          message: error.cause instanceof Error ? this.#redactMcp(error.cause.message) : "unknown",
        });
      }),
    );
  }

  readonly start = Effect.fn("ProviderRuntime.start")(function* (this: ProviderRuntime) {
    if (this.#scope.state._tag === "Closed") this.#scope = Scope.makeUnsafe();
    this.#idleCheck ??= setInterval(
      () => Effect.runFork(this.#releaseIdleProviders().pipe(Effect.forkIn(this.#scope))),
      PROVIDER_IDLE_CHECK_MS,
    );
    this.#idleCheck.unref?.();
    this.#watchSignInFiles();
    yield* this.#connect(
      "starting",
      BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id),
    );
  }).bind(this);

  /**
   * A provider found signed out at start keeps no client, and nothing else asks it again. A user who
   * signs in with the provider's own CLI, such as over SSH on a server, would see it signed out until
   * a restart (#2895). The version is read before the start check, so a sign-in that ends during
   * that check is not missed.
   */
  #watchSignInFiles(): void {
    for (const driver of BUILT_IN_PROVIDER_DRIVERS) {
      const path = driver.signInFile?.();
      if (path && !this.#signInFiles.has(driver.id))
        this.#signInFiles.set(driver.id, { path, seen: signInFileVersion(path) });
    }
    if (this.#signInFiles.size === 0) return;
    this.#signInCheck ??= setInterval(() => this.#checkSignInFiles(), SIGN_IN_FILE_POLL_MS);
    this.#signInCheck.unref?.();
  }

  /**
   * Only a signed-out row is checked again: the CLI also writes the file to refresh a token, and a
   * provider that stopped at `START_FAILURE_LIMIT` must wait for the user. A change that comes while
   * a check runs keeps its new version, so a later poll checks it. A sign-in or a Connect that
   * OpenBot started checks the account itself when it ends.
   */
  #checkSignInFiles(): void {
    if (this.#status.phase === "starting" || this.#status.phase === "restarting" || this.#providerRefresh) return;
    for (const [provider, file] of this.#signInFiles) {
      const row = this.#status.providers?.find((candidate) => candidate.id === provider);
      if (row?.state !== "sign-in-required") continue;
      if (this.#cliLogin.has(provider) || this.#providerConnectionCommands.has(provider)) continue;
      const version = signInFileVersion(file.path);
      if (version === file.seen) continue;
      file.seen = version;
      Effect.runFork(
        this.#startProvider(provider, { preserveCheckErrors: true }).pipe(Effect.ignore, Effect.forkIn(this.#scope)),
      );
    }
  }

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
    if (provider === "acp" && this.#removingCustomRuntime)
      return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.registryRemoveBusy")) });
    yield* providerStep(() => this.requireProviderOn(provider));
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

  /**
   * `automatic`: the app asked, not the user, so a provider that OpenBot stopped starting
   * (`START_FAILURE_LIMIT`) stays stopped.
   */
  readonly refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (
    this: ProviderRuntime,
    options: { automatic: boolean },
  ) {
    if (!options.automatic) this.#startFailures.clear();
    // A refresh cancels a sign-in that has not finished. The sign-in process of an expired account
    // writes a 401 for the old token, and the renderer refreshes after each auth error, so the
    // sign-in would end before the user enters the code. The sign-in is what fixes that error. A
    // sign-in that is starting runs as a connection command, and the refresh would wait for it and
    // then cancel it.
    if (
      options.automatic &&
      (this.#codexLogin.pending || this.#cliLogin.size > 0 || this.#providerConnectionCommands.size > 0)
    )
      return this.status();
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
    if (this.#off.has(provider) || this.#clients.has(provider)) return this.status();
    this.#resetRestarts(provider);
    this.#startFailures.delete(provider);
    yield* this.#startProvider(provider, { preserveCheckErrors: true, refreshRuntimeInBackground: true });
    return this.status();
  }).bind(this);

  readonly #startProvider = Effect.fn("ProviderRuntime.startProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    options: { notifyReady?: boolean; preserveCheckErrors?: boolean; refreshRuntimeInBackground?: boolean },
    phase: "starting" | "restarting" = "starting",
  ) {
    if (this.#off.has(provider) || (provider === "acp" && this.#removingCustomRuntime)) return;
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
   * is only reached by a `browser` or `muse-device` sign-in, whose login hands back a URL; a
   * `cli-command` sign-in opens its own browser window from the CLI OpenBot spawns, and an
   * `external` sign-in happens outside OpenBot, so Connect only asks the provider again.
   */
  readonly connectProvider = Effect.fn("ProviderRuntime.connectProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
  ) {
    return yield* this.#connectProvider(provider, openExternal, false);
  }).bind(this);

  /** `onHost`: the user is not at this computer, so the CLI's page goes to `openExternal`, never to a browser here. */
  readonly #connectProvider = Effect.fn("ProviderRuntime.connectProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
  ) {
    this.#startFailures.delete(provider);
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    if (start && this.#clients.has(provider) && this.#accounts.has(provider)) return this.status();
    if (this.#providerRefresh || (!start && ["starting", "restarting"].includes(this.#status.phase))) {
      return this.status();
    }
    const signIn = requireProviderDriver(provider).signIn;
    return yield* this.#runProviderConnectionCommand(provider, () =>
      this.#signIn(provider, signIn, openExternal, onHost),
    );
  });

  readonly #signIn = Effect.fn("ProviderRuntime.signIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    signIn: ReturnType<typeof requireProviderDriver>["signIn"],
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
  ) {
    switch (signIn.kind) {
      case "browser":
        yield* this.#codexLogin.cancel(null);
        yield* this.#codexLogin.startBrowser(openExternal).pipe(toProviderOperationFailed);
        return this.status();
      case "cli-command":
        yield* this.#cancelCliLogin(provider);
        yield* this.#cliLogin
          .start(provider, (cli) =>
            Effect.gen(function* () {
              const browser = onHost ? yield* captureBrowser(openExternal) : {};
              const target = cliSpawnTarget(cli.executable, signIn.command.argv);
              const child = yield* Effect.acquireRelease(
                Effect.try({
                  try: () =>
                    spawn(target.command, target.args, {
                      cwd: process.cwd(),
                      env: { ...process.env, ...signIn.command.env(cli), ...browser },
                      stdio: "ignore",
                      shell: false,
                      windowsHide: process.platform === "win32",
                      windowsVerbatimArguments: target.windowsVerbatimArguments,
                    }),
                  catch: (cause) => new CliLoginFailed({ cause }),
                }),
                (child) => stopProcessTree(child).pipe(Effect.orDie),
              );
              return { child, done: waitForSuccessfulProcess(child, signIn.command.timeoutMs) };
            }),
          )
          .pipe(toProviderOperationFailed);
        return this.status();
      case "acp-authenticate": {
        // A Reconnect of a Google sign-in signs out first: the saved token would answer it with no
        // browser page. A saved key wins over Google, so it keeps the token. A provider that the idle
        // timer released is still connected.
        const fresh =
          provider === "antigravity" &&
          this.#status.providers?.find((row) => row.id === provider)?.state === "available" &&
          !this.#credentials.apiKey("antigravity");
        // The sign-out removes the credential that a running turn uses.
        if (fresh && this.#hooks.isProviderBusy(provider)) {
          return yield* new ProviderOperationFailed({
            cause: new Error(sourceText("error.provider.cliBusyReconnect", { provider: providerLabel(provider) })),
          });
        }
        yield* this.#cancelCliLogin(provider);
        const disposals = this.#disposals;
        const temp = provider === "antigravity" ? antigravityTemp(this.#credentials) : undefined;
        yield* this.#cliLogin
          .start(provider, (cli) => {
            let loggedOut = false;
            return startAcpAuthentication({
              executable: cli.executable,
              argv: signIn.argv,
              env: { ...signIn.env },
              methodId: signIn.methodId,
              timeoutMs: signIn.timeoutMs,
              ...(fresh
                ? {
                    logout: true,
                    onLoggedOut: () => {
                      loggedOut = true;
                    },
                  }
                : {}),
              privateTemp: temp && { ...temp, provider: providerLabel(provider) },
              ...(provider === "antigravity" ? { openGoogleSignIn: openExternal } : {}),
            }).pipe(
              // A sign-in that stops after the sign-out leaves no account behind it.
              Effect.map((login) => ({
                ...login,
                done: login.done.pipe(
                  Effect.onError(() => (loggedOut ? this.#endSignedOutClient(provider, disposals) : Effect.void)),
                ),
              })),
            );
          })
          .pipe(toProviderOperationFailed);
        return this.status();
      }
      case "external":
        return yield* this.#reprobeProvider(provider);
      case "terminal":
        yield* this.#cancelCliLogin(provider);
        yield* this.#cliLogin
          .start(provider, (cli) => startProviderTerminalLogin(cli, signIn.timeoutMs))
          .pipe(toProviderOperationFailed);
        return this.status();
      case "muse-device": {
        const started = yield* this.#startProviderCode(provider, signIn);
        if (started.kind !== "code") return this.status();
        // A page that did not open cannot finish the sign-in, so its code stops working.
        yield* Effect.tryPromise({
          try: () => openExternal(started.verificationUrlComplete ?? started.verificationUrl),
          catch: (cause) => new ProviderOperationFailed({ cause }),
        }).pipe(Effect.tapError(() => this.#cancelCliLogin(provider).pipe(Effect.ignore)));
        return this.status();
      }
    }
  });

  /**
   * Signs a provider account after the first in through the browser: a new one when `accountId` is
   * null. Answers when the sign-in starts; the account row in the status reports how it ends.
   */
  readonly connectProviderAccount = Effect.fn("ProviderRuntime.connectProviderAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    const signIn = yield* accounts.connect(provider, accountId, openExternal, false).pipe(toProviderOperationFailed);
    // A new account that fails goes with its row, so the error is the only report of why. A cancel
    // interrupts the sign-in and shows nothing.
    if (accountId === null)
      yield* signIn.ended.pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            if (error) this.#emitError(`${provider}_account_sign_in_failed`, error);
          }),
        ),
        Effect.forkIn(this.#scope),
      );
    return this.status();
  }).bind(this);

  /**
   * Signs a provider account after the first in through the page that its CLI prints, which
   * `openPage` shows, and waits until the sign-in ends. For a host whose browser the user reaches only
   * through a live view (`provider-accounts-v1`). An interrupt cancels the sign-in.
   */
  readonly signInProviderAccountOnHost = Effect.fn("ProviderRuntime.signInProviderAccountOnHost")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
    openPage: (url: string) => Promise<void>,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    // The start runs uninterruptible, so an interrupt at any point cancels the sign-in it started.
    const error = yield* Effect.acquireUseRelease(
      accounts.connect(provider, accountId, openPage, true).pipe(toProviderOperationFailed),
      (signIn) => signIn.ended,
      (signIn, exit) =>
        Exit.hasInterrupts(exit) ? accounts.cancel(provider, signIn.accountId, signIn.signIn) : Effect.void,
    );
    if (error) return yield* new ProviderOperationFailed({ cause: new Error(error) });
  }).bind(this);

  /** Stops the sign-in of an account. A new account goes with its folder; another one shows as signed out. */
  readonly cancelProviderAccountSignIn = Effect.fn("ProviderRuntime.cancelProviderAccountSignIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string,
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.cancel(provider, accountId);
    return this.status();
  }).bind(this);

  readonly renameProviderAccount = Effect.fn("ProviderRuntime.renameProviderAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string,
    label: string | null,
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.rename(provider, accountId, label).pipe(toProviderOperationFailed);
    return this.status();
  }).bind(this);

  /** The service moves the account's agents to the provider's own sign-in before it calls this. */
  readonly removeProviderAccount = Effect.fn("ProviderRuntime.removeProviderAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string,
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.remove(provider, accountId).pipe(toProviderOperationFailed);
    return this.status();
  }, Effect.uninterruptible).bind(this);

  /**
   * Signs the provider's own sign-in out and reports it signed out. Its agents wait for a sign-in;
   * the provider's other accounts wait until it connects again.
   */
  readonly signOutProvider = Effect.fn("ProviderRuntime.signOutProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    // Codex signs in, by browser or by code, through its own login client.
    const codex = requireProviderDriver(provider).signIn.kind === "browser";
    return yield* this.#runProviderConnectionCommand(provider, () =>
      Effect.gen({ self: this }, function* () {
        // The sign-out removes the credential that a running turn uses.
        if (this.#hooks.isProviderBusy(provider)) {
          return yield* new ProviderOperationFailed({
            cause: new Error(sourceText("error.provider.cliBusySignOut", { provider: providerLabel(provider) })),
          });
        }
        // A sign-in that finished after the sign-out would sign the provider in again.
        yield* codex ? this.#codexLogin.cancel(null) : this.#cancelCliLogin(provider);
        const disposals = this.#disposals;
        yield* accounts.signOutDefault(provider).pipe(toProviderOperationFailed);
        yield* this.#endSignedOutClient(provider, disposals);
        return this.status();
      }),
    );
  }, Effect.uninterruptible).bind(this);

  /** Whether the provider has a saved API key. */
  hasProviderKey(provider: AgentProvider): boolean {
    return this.#credentials.apiKey(provider) !== null;
  }

  /** True when the provider's own sign-in runs on its saved key, because it has no other login. */
  ownSignInUsesKey(provider: AgentProvider): boolean {
    return this.#accounts.get(provider)?.type === CLAUDE_API_KEY_ACCOUNT_TYPE;
  }

  /** Gives a saved key its account and checks it again; see `ProviderAccounts.keyChanged`. */
  providerKeyChanged(provider: AgentProvider): Effect.Effect<AgentStatus> {
    return (this.#providerAccounts?.keyChanged(provider) ?? Effect.void).pipe(Effect.map(() => this.status()));
  }

  /** True when `accountId` names an account after the first that this computer holds. */
  hasProviderAccount(provider: AgentProvider, accountId: string): boolean {
    return this.#providerAccounts?.account(provider, accountId) != null;
  }

  #requireAccounts(provider: AgentProvider): Effect.Effect<ProviderAccounts, ProviderOperationFailed> {
    const accounts = this.#providerAccounts;
    if (accounts && provider !== "acp" && ProviderAccounts.support(provider)) return Effect.succeed(accounts);
    return Effect.fail(
      new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) })),
      }),
    );
  }

  /**
   * Signs `provider` in through the page that its CLI prints, which `openPage` shows, and waits until
   * the sign-in ends. For a host whose browser the user reaches only through a live view
   * (`provider-host-sign-in-v1`). Fails with the reason when the provider is not signed in at the end.
   */
  readonly signInProviderOnHost = Effect.fn("ProviderRuntime.signInProviderOnHost")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openPage: (url: string) => Promise<void>,
  ) {
    yield* this.#connectProvider(provider, openPage, true);
    // A sign-in that ended before this read leaves no task; the clients then tell how it ended.
    const pending =
      requireProviderDriver(provider).signIn.kind === "browser"
        ? this.#codexLogin.settled()
        : this.#cliLogin.settled(provider);
    const signedIn = (yield* pending) ?? (this.#clients.has(provider) && this.#accounts.has(provider));
    if (signedIn) return;
    const message = this.#status.providers?.find((status) => status.id === provider)?.message;
    return yield* new ProviderOperationFailed({
      cause: new Error(message ?? sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) })),
    });
  }).bind(this);

  /** Ends a sign-in that `signInProviderOnHost` started. The CLI stops, so its page cannot finish it. */
  readonly cancelProviderSignIn = Effect.fn("ProviderRuntime.cancelProviderSignIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    // Codex signs in through its app-server, not a CLI login, and holds its callback port until it ends.
    const browser = requireProviderDriver(provider).signIn.kind === "browser";
    return yield* this.#runProviderConnectionCommand(provider, () =>
      (browser ? this.#codexLogin.cancel(null) : this.#cancelCliLogin(provider)).pipe(Effect.map(() => this.status())),
    );
  }).bind(this);

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

  /**
   * Saves an OpenAI API key as Codex's login, for `changeProviderCredential` to restart Codex on. A
   * pending ChatGPT sign-in ends first, so that it cannot replace the key when it finishes.
   */
  readonly saveCodexApiKey = Effect.fn("ProviderRuntime.saveCodexApiKey")(function* (
    this: ProviderRuntime,
    apiKey: string,
  ) {
    yield* this.#codexLogin.cancel(null);
    yield* this.#codexLogin.saveApiKey(apiKey).pipe(toProviderOperationFailed);
  }).bind(this);

  readonly #startProviderCode = Effect.fn("ProviderRuntime.startCodeLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    codeSignIn: NonNullable<ReturnType<typeof requireProviderDriver>["codeSignIn"]>,
  ): Effect.fn.Return<ProviderCodeLoginStart, ProviderOperationFailed> {
    if (codeSignIn.kind === "codex-device") {
      yield* this.#codexLogin.cancel(null);
      return yield* this.#codexLogin.startDevice().pipe(toProviderOperationFailed);
    }
    yield* this.#cancelCliLogin(provider);
    if (codeSignIn.kind === "muse-device") {
      return yield* this.#cliLogin
        .startCode(
          provider,
          (cli) => startMuseDeviceLogin({ cli, timeoutMs: codeSignIn.timeoutMs }),
          codeSignIn.timeoutMs,
        )
        .pipe(toProviderOperationFailed);
    }
    const { command, flow } = codeSignIn;
    return yield* this.#cliLogin
      .startCode(
        provider,
        (cli) =>
          startCliCodeLogin({
            flow,
            executable: cli.executable,
            argv: command.argv,
            env: { ...cliPathEnvironment(cli), ...command.env(cli) },
            timeoutMs: command.timeoutMs,
          }),
        command.timeoutMs,
      )
      .pipe(toProviderOperationFailed);
  }, Effect.uninterruptible);

  /**
   * Types the code the provider's page showed into the CLI that is waiting for it. The code is a
   * credential: it goes to the CLI's stdin and nowhere else. How the sign-in ends arrives as the
   * provider's status.
   */
  submitProviderCodeLogin(provider: AgentProvider, code: string): AgentStatus {
    this.#cliLogin.submit(provider, code);
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
        else yield* this.#cancelCliLogin(provider);
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
   * durable, and the idle check applies the respawn after the turn stops.
   *
   * It reports how the respawn went and never throws, because the caller has already written the
   * endpoint to disk: a throw here would read to the user as a save that failed. A respawn that
   * fails - an endpoint OpenCode refuses at spawn - is reported the way every other connection
   * failure is, as an error state and a message on the provider's own status.
   */

  readonly reloadOpenCodeConfig = Effect.fn("ProviderRuntime.reloadOpenCodeConfig")(function* (
    this: ProviderRuntime,
  ): Effect.fn.Return<CustomProviderRestart> {
    this.#environmentReloadPending.delete("opencode");
    if (!this.#clients.has("opencode")) return "not-running";
    if (this.#hooks.isProviderBusy("opencode")) {
      this.#environmentReloadPending.add("opencode");
      return "skipped-busy";
    }
    const result = yield* Effect.result(
      this.#runProviderConnectionCommand("opencode", () => this.#reprobeProvider("opencode")),
    );
    if (Result.isFailure(result) && this.#hooks.isProviderBusy("opencode")) {
      this.#environmentReloadPending.add("opencode");
      return "skipped-busy";
    }
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
    if (this.#off.has(provider)) return;
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
      yield* this.refreshProvider("acp").pipe(toProviderOperationFailed);
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

  /** Holds ACP process ownership while managed executable files are removed. */
  withCustomAgentRuntimeRemoval<T>(
    operation: () => Effect.Effect<T, ProviderOperationFailed>,
  ): Effect.Effect<T, ProviderOperationFailed> {
    return this.#runProviderConnectionCommand(
      "acp",
      () =>
        Effect.gen({ self: this }, function* () {
          this.#removingCustomRuntime = true;
          this.#replacingCli.add("acp");
          recordRestartActivity();
          return yield* Effect.gen({ self: this }, function* () {
            const start = this.#providerStarts.get("acp");
            if (start) yield* Deferred.await(start).pipe(Effect.ignore);
            for (const pending of this.#confinedStarts.values()) yield* Deferred.await(pending).pipe(Effect.ignore);
            if (this.#hooks.isProviderBusy("acp"))
              return yield* new ProviderOperationFailed({
                cause: new Error(sourceText("error.provider.registryRemoveBusy")),
              });
            yield* this.#stopProviderClient("acp");
            return yield* operation();
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                this.#removingCustomRuntime = false;
                this.#replacingCli.delete("acp");
                this.#hooks.onProviderResumed("acp");
              }),
            ),
          );
        }),
      false,
    );
  }

  /** Stops a provider's shared process and every Workspace only process of it, with no restart. */
  readonly #stopProviderClient = Effect.fn("ProviderRuntime.stopProviderClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const client = this.#clients.get(provider);
    if (client) {
      // Remove ownership first so a process exit cannot start a replacement.
      yield* providerStep(() => {
        this.#clients.delete(provider);
        this.#cli.delete(provider);
        this.#accounts.delete(provider);
        this.#conversation.unloadClientThreads(client);
      });
      yield* client.stop().pipe(Effect.catch(() => Effect.void));
      yield* this.#hooks.onClientStopped(client);
    }
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
    // A shared process that was released when idle starts again without a new activation, and an
    // agent's own process would then keep the old credential until it idles out (#2544).
    this.#countActivation(provider);
    // The new credential's usage is read at the next poll, not after the old one's wait.
    this.#forgetUsage(provider);
    return yield* this.#reprobeProvider(provider);
  }, Effect.uninterruptible);

  /**
   * Keeps this provider idle until its managed runtime is installed and activated. While a turn runs
   * on the provider, the update waits for its turns to end and new turns wait for the update, as for
   * `restartProviderWhenIdle`. `onWait` runs when such a wait starts. `signal` ends the wait when the
   * download is cancelled or the app stops.
   */
  updateProviderCli(
    provider: AgentProvider,
    install: () => Effect.Effect<string, ProviderOperationFailed>,
    signal: AbortSignal,
    onWait: () => void,
  ): Effect.Effect<AgentStatus, ProviderOperationFailed> {
    return this.#updateProviderCliWhenIdle(provider, install, signal, onWait).pipe(
      Effect.ensuring(Effect.sync(() => this.#endUpdateWhenIdle(provider))),
    );
  }

  readonly #updateProviderCliWhenIdle = Effect.fn("ProviderRuntime.updateCliWhenIdle")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    install: () => Effect.Effect<string, ProviderOperationFailed>,
    signal: AbortSignal,
    onWait: () => void,
  ) {
    while (true) {
      yield* this.#awaitIdleForUpdate(provider, signal, onWait);
      const status = yield* this.#runProviderConnectionCommand(provider, () =>
        this.#updateProviderCli(provider, install),
      );
      if (status) return status;
    }
  });

  readonly #awaitIdleForUpdate = Effect.fn("ProviderRuntime.awaitIdleForUpdate")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    signal: AbortSignal,
    onWait: () => void,
  ) {
    while (true) {
      if (signal.aborted) return yield* new ProviderOperationFailed({ cause: signal.reason });
      if (this.#hooks.isStopping())
        return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.closing")) });
      if (!this.#hooks.isProviderBusy(provider)) return;
      if (!this.#updatesWhenIdle.has(provider)) {
        this.#updatesWhenIdle.add(provider);
        recordRestartActivity();
        onWait();
      }
      yield* Effect.sleep(PROVIDER_RESTART_POLL_MS);
    }
  });

  /** Ends a wait that did not reach the install, because it was cancelled or failed. */
  #endUpdateWhenIdle(provider: AgentProvider): void {
    if (this.#updatesWhenIdle.delete(provider)) this.#hooks.onProviderResumed(provider);
  }

  /** Answers null, and installs nothing, when a turn started on the provider after the wait. */
  readonly #updateProviderCli = Effect.fn("ProviderRuntime.updateCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    install: () => Effect.Effect<string, ProviderOperationFailed>,
  ) {
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    const busy = yield* providerStep(() => {
      if ((provider === "codex" && this.#codexLogin.pending) || this.#cliLogin.has(provider))
        throw new Error(sourceText("error.provider.cliSigningIn", { provider: providerLabel(provider) }));
      return this.#hooks.isProviderBusy(provider);
    });
    if (busy) return null;
    const previousVersion = this.#cli.get(provider)?.version ?? null;
    const previousExecutable = this.#bundledExecutables[provider];
    // Main names the install path of a managed provider also before its first download, so only a
    // file on disk is a version to go back to.
    const firstInstall = yield* providerStep(
      () => !previousExecutable || !statSync(previousExecutable, { throwIfNoEntry: false }),
    );
    // A reprobe that finds no account leaves the provider released, so only an available row keeps it.
    const wasAvailable = this.#status.providers?.find((row) => row.id === provider)?.state === "available";
    let installed = false;
    yield* Effect.acquireUseRelease(
      providerStep(() => {
        // The hold passes from the wait to the install with no gap in which a turn could start.
        this.#updatesWhenIdle.delete(provider);
        this.#setProviderConnectionState(provider, "connecting", false);
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
          yield* this.#reloadProviderCli(provider, cli, firstInstall);
        }).pipe(
          Effect.mapError((error) => {
            if (previousExecutable === undefined) delete this.#bundledExecutables[provider];
            else this.#bundledExecutables[provider] = previousExecutable;
            const cause = error.cause;
            const failure = new Error(
              sourceText("error.provider.cliUpdateFailed", {
                provider: providerLabel(provider),
                // Catalog text only: a system error names private paths, and team admins read this status.
                reason:
                  cause instanceof Error && matchingSourceKeys(cause.message).length > 0
                    ? redactText(cause.message)
                    : sourceText("error.provider.tryAgain"),
              }),
              { cause },
            );
            // Before the install, the old CLI is untouched: a provider that the idle timer released keeps its account.
            this.#setProviderConnectionFailure(
              provider,
              failure,
              previousVersion,
              installed,
              !installed && wasAvailable,
            );
            return new ProviderOperationFailed({ cause: failure });
          }),
        ),
      () =>
        Effect.sync(() => {
          this.#replacingCli.delete(provider);
          this.#hooks.onProviderResumed(provider);
        }),
    );
    // A provider that runs this CLI, such as Inception, DeepSeek or OpenRouter on Pi, moves to the new binary
    // when its own turns end. One with no process, such as one that found no CLI, is checked again now.
    for (const driver of BUILT_IN_PROVIDER_DRIVERS) {
      if (driver.cliProvider !== provider || this.#off.has(driver.id)) continue;
      yield* (
        this.#clients.has(driver.id) ? this.restartProviderWhenIdle(driver.id) : this.#reprobeProvider(driver.id)
      ).pipe(Effect.ignore);
    }
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
    return this.#ownProcessFor(agent) ? null : this.clientFor(providerForAgent(agent));
  }

  /**
   * The process that can read this agent's saved sessions without starting one. An agent on a
   * provider account after the first keeps them in that account's folder, which only its own process
   * reads, so this is null while that process does not run.
   */
  historyClientForAgent(agent: AgentSummary): AgentClient | null {
    const provider = providerForAgent(agent);
    const account = this.#providerAccounts?.account(provider, agent.providerAccountId);
    if (!account) return this.clientFor(provider);
    const confined = this.#confined.get(agent.id);
    return confined?.accountId === account.id ? confined.client : null;
  }

  /** True while this agent has a process of its own, or one starts. An exit of the shared process leaves it. */
  runsOnOwnProcess(agentId: string): boolean {
    return this.#confined.has(agentId) || this.#confinedStarts.has(agentId);
  }

  /**
   * Stops the agent's own process, after a start that is still running. The process runs in the
   * agent's workspace, and Windows refuses to remove a folder that a live process uses (`EBUSY`).
   */
  readonly stopAgentProcess = Effect.fn("ProviderRuntime.stopAgentProcess")(function* (
    this: ProviderRuntime,
    agentId: string,
  ) {
    yield* this.#awaitConfinedStart(agentId);
    const confined = this.#confined.get(agentId);
    if (confined) yield* this.#stopConfined(agentId, confined);
  }, Effect.uninterruptible).bind(this);

  /** Waits until no start of the agent's own process is running. */
  readonly #awaitConfinedStart = Effect.fn("ProviderRuntime.awaitConfinedStart")(function* (
    this: ProviderRuntime,
    agentId: string,
  ) {
    for (let pending = this.#confinedStarts.get(agentId); pending; pending = this.#confinedStarts.get(agentId)) {
      const currentStart = pending;
      yield* Deferred.await(currentStart).pipe(Effect.ignore);
    }
  });

  /**
   * Like `requireReadyClient`, for the process that runs this agent's turns. An agent's own process
   * does not need the shared one, so its turn can still be interrupted while the shared one restarts.
   */
  requireReadyClientForAgent(agent: AgentSummary): AgentClient {
    const provider = providerForAgent(agent);
    if (provider === "acp" && this.#removingCustomRuntime)
      throw new Error(sourceText("error.provider.registryRemoveBusy"));
    if (!this.#confined.has(agent.id) && !this.#ownProcessFor(agent)) return this.requireReadyClient(provider);
    const client = this.clientForAgent(agent);
    if (!client) throw new Error(sourceText("error.provider.noAgentProcess", { provider: providerLabel(provider) }));
    return client;
  }

  /**
   * False when `ensureAgentClient` would stop this agent's own process to start another one. A task
   * of the agent waits then while another of its turns runs on that process.
   */
  agentClientCurrent(agent: AgentSummary): boolean {
    const current = this.#confined.get(agent.id);
    if (!current) return true;
    const own = this.#ownProcessFor(agent);
    return own !== null && current.key === this.#confinedKey(providerForAgent(agent), own);
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
    yield* this.#awaitConfinedStart(agent.id);
    if (provider === "acp" && this.#removingCustomRuntime)
      return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.registryRemoveBusy")) });
    yield* checkAgentFolders(agent);
    const own = this.#ownProcessFor(agent);
    const current = this.#confined.get(agent.id);
    const key = own ? this.#confinedKey(provider, own) : null;
    if (current && current.key === key) {
      current.lastUsed = Date.now();
      return current.client;
    }
    if (current) yield* this.#stopConfined(agent.id, current);
    if (!own || !key) return yield* providerStep(() => this.requireReadyClient(provider));
    const completion = Deferred.makeUnsafe<AgentClient, ProviderOperationFailed>();
    this.#confinedStarts.set(agent.id, completion);
    const exit = yield* Effect.exit(this.#startConfined(agent.id, provider, own, key));
    yield* Deferred.done(completion, exit);
    if (this.#confinedStarts.get(agent.id) === completion) this.#confinedStarts.delete(agent.id);
    return yield* exit;
  }, Effect.uninterruptible).bind(this);

  #countActivation(provider: AgentProvider): void {
    this.#activations.set(provider, (this.#activations.get(provider) ?? 0) + 1);
  }

  /**
   * What an agent's own process starts with, or null when the agent runs on the shared process. An
   * account that was removed sends the agent back to the shared process.
   */
  #ownProcessFor(agent: AgentSummary): OwnProcess | null {
    const provider = providerForAgent(agent);
    const confined =
      workspaceAccessEnforced(agent) && agentProviderDescriptor(provider).workspaceEnforcement === "confined-process";
    const account = this.#providerAccounts?.account(provider, agent.providerAccountId) ?? null;
    if (!confined && !account) return null;
    return {
      ...(confined
        ? {
            confinement: {
              writableRoots: workspaceWritableRoots(agent, this.#hooks.sharedRoot()),
              excludedFolders: workspaceExcludedFolders(agent),
            },
          }
        : {}),
      ...(account ? { account } : {}),
    };
  }

  /**
   * The shared process is part of the key: it is replaced when the CLI, a stored key or the custom
   * endpoints change, and the agent's own process must then start again with the same values.
   */
  #confinedKey(provider: AgentProvider, own: OwnProcess): string {
    const cli = this.#cli.get(provider);
    return JSON.stringify([
      cli?.executable ?? null,
      cli?.version ?? null,
      this.#activations.get(provider) ?? 0,
      own.confinement?.writableRoots ?? null,
      own.confinement?.excludedFolders ?? null,
      own.account?.id ?? null,
    ]);
  }

  readonly #startConfined = Effect.fn("ProviderRuntime.startConfined")(function* (
    this: ProviderRuntime,
    agentId: string,
    provider: AgentProvider,
    own: OwnProcess,
    key: string,
  ) {
    const cli = this.#cli.get(provider);
    if (!cli)
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) })),
      });
    // A CLI that ignores the account's folder would run the agent on the provider's own sign-in.
    if (own.account && !this.#providerAccounts?.supported(provider))
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) })),
      });
    const disposals = this.#disposals;
    const accountEnvironment = own.account ? this.#providerAccounts?.environment(own.account) : undefined;
    const slowStartTimeoutMs = this.#slowStarts.get(provider);
    const { client } = yield* this.#authenticateClient(provider, cli, {
      ...(slowStartTimeoutMs === undefined ? {} : { startTimeoutMs: slowStartTimeoutMs }),
      ...(own.confinement ? { confinement: own.confinement } : {}),
      ...(accountEnvironment ? { accountEnvironment } : {}),
    });
    if (disposals !== this.#disposals || this.#hooks.isStopping()) {
      yield* client.stop().pipe(Effect.catch(() => Effect.void));
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.stoppedBeforeAgentProcess", { provider: providerLabel(provider) })),
      });
    }
    this.#confined.set(agentId, { client, key, accountId: own.account?.id ?? null, lastUsed: Date.now() });
    logger.info("Started an agent's own provider process.", {
      provider,
      agentId,
      confined: own.confinement !== undefined,
      account: own.account !== undefined,
    });
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
   * restart the user asked for, or an update, waits for the provider's turns to end.
   */
  isReplacingCli(provider: AgentProvider): boolean {
    return (
      this.#replacingCli.has(provider) || this.#restartsWhenIdle.has(provider) || this.#updatesWhenIdle.has(provider)
    );
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
    this.#startFailures.delete(provider);
    if (!this.#clients.has(provider)) {
      if (this.#released.has(provider)) {
        // A failed start is reported on the provider status, as for a turn that wakes it.
        yield* this.ensureProvider(provider).pipe(toProviderOperationFailed).pipe(Effect.ignore);
        return this.status();
      }
      return yield* this.refreshProvider(provider).pipe(toProviderOperationFailed);
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
      this.#cliLogin.has(provider) ||
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
    if (provider === "acp" && this.#removingCustomRuntime)
      throw new Error(sourceText("error.provider.registryRemoveBusy"));
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

  /**
   * Router arm: the CLI pushed new rate limits. The push is sparse, so a window it leaves out keeps its last
   * value. A push for another bucket, or one that cannot be read, waits for the next reading. The readings of
   * added accounts follow their own reads. The event holds every row, because the web client replaces its rows
   * with each event; a provider that stopped reporting is left out, so its row does not come back.
   */
  applyPushedUsage(source: AgentClient, params: unknown): void {
    const provider = source.provider;
    if (this.#clients.get(provider) !== source) return;
    const pushed = pushedUsageLimit(provider, params);
    if (!pushed) return;
    const kept = this.#lastUsage.get(provider);
    const limit = {
      ...kept,
      id: provider,
      primary: pushed.primary ?? kept?.primary ?? null,
      secondary: pushed.secondary ?? kept?.secondary ?? null,
    };
    this.#usageUnreported.delete(provider);
    this.#lastUsage.set(provider, limit);
    const limits = [...this.#lastUsage]
      .filter(([item]) => !this.#usageUnreported.has(item) && (this.#clients.has(item) || this.#released.has(item)))
      .map(([, item]) => item);
    this.#emit({ type: "usage-changed", usage: structuredClone({ limits }) });
  }

  /** Refresh the notice once when one provider reports the same exhausted balance several ways. */
  readonly refreshUsageAfterLimit = Effect.fn("ProviderRuntime.refreshUsageAfterLimit")(function* (
    this: ProviderRuntime,
    source: AgentClient,
  ) {
    if (!agentProviderDescriptor(source.provider).reportsUsage) return;
    const client = this.#clients.get(source.provider);
    if (!client || this.#usageLimitRefreshes.has(client)) return;
    this.#usageLimitRefreshes.add(client);
    // A provider with no reading, such as Gemini with an API key, must not clear the other
    // providers' readings: the renderer takes an empty reading as the whole dock.
    yield* this.#refreshUsage(client, undefined, false).pipe(
      Effect.tap((usage) =>
        Effect.sync(() => {
          if (usage.limits.length === 0) return;
          // With no model, this is not the dock's reading of a provider whose limits depend on the model, so
          // the next poll reads that again instead of answering with one older than this event.
          if (defaultUsageModel(source.provider) !== undefined) this.#usageGate(source.provider).reset();
          this.#emit({ type: "usage-changed", usage });
        }),
      ),
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
    if (this.#signInCheck) clearInterval(this.#signInCheck);
    this.#signInCheck = null;
    this.#signInFiles.clear();
    this.#released.clear();
    const loginClient = this.#codexLogin.dispose();
    const stopCliLogins = this.#cliLogin.dispose();
    this.#providerConnectionCommands.clear();
    yield* stopCliLogins;
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
    requireOn = true,
  ) {
    if (requireOn) yield* providerStep(() => this.requireProviderOn(provider));
    const previous = this.#providerConnectionCommands.get(provider);
    const completion = Deferred.makeUnsafe<void, ProviderOperationFailed>();
    this.#providerConnectionCommands.set(provider, completion);
    recordRestartActivity();
    if (previous) yield* Deferred.await(previous).pipe(Effect.ignore);
    const exit = yield* Effect.exit(
      Effect.gen({ self: this }, function* () {
        if (requireOn) yield* providerStep(() => this.requireProviderOn(provider));
        return yield* Effect.suspend(command);
      }),
    );
    yield* Deferred.done(completion, Exit.asVoid(exit));
    if (this.#providerConnectionCommands.get(provider) === completion)
      this.#providerConnectionCommands.delete(provider);
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (this: ProviderRuntime) {
    yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS.filter((driver) => !this.#off.has(driver.id)),
      (driver) =>
        this.#runProviderConnectionCommand(driver.id, () =>
          driver.signIn.kind === "browser" ? this.#codexLogin.settleForRefresh() : this.#cancelCliLogin(driver.id),
        ).pipe(toProviderOperationFailed),
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
      this.#setStatus(providers === undefined ? {} : { providers });
    }
    yield* Effect.forEach(activeClients, ([provider, client]) => this.#refreshAccount(provider, client), {
      concurrency: "unbounded",
      discard: true,
    });

    const providers = BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter(
      (provider) => !this.#off.has(provider),
    );
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
          .pipe(toProviderOperationFailed);
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
        // The next sign-in can be another login.
        this.#forgetUsage(provider);
        yield* client.stop().pipe(toProviderOperationFailed).pipe(Effect.ignore);
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
    if (!(error instanceof AgentProcessExitError)) return error;
    const detailed = error.withDetail(this.#redactMcp);
    // OpenCode 2 makes a database with only `session_v2`, and OpenCode 1 refuses it (OpenCode issue #53221).
    // The catalog text tells the user what fixes it; onboarding shows only catalog text.
    return OPENCODE_NEWER_DATABASE.test(detailed.message)
      ? new AgentProcessExitError(sourceText("error.provider.opencodeDatabaseNewer"), null, { cause: detailed })
      : detailed;
  }

  readonly #initializeProviderClient = Effect.fn("ProviderRuntime.initializeProviderClient")(function* (
    client: AgentClient,
    startTimeoutMs?: number,
  ) {
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
      .pipe(toProviderOperationFailed);
    yield* providerStep(() => client.notify("initialized"));
  });

  readonly #authenticateClient = Effect.fn("ProviderRuntime.authenticateClient")(
    function* (
      this: ProviderRuntime,
      provider: AgentProvider,
      cli: AgentCliInfo,
      {
        confinement,
        startTimeoutMs,
        accountEnvironment,
        interruptibleStart,
      }: {
        confinement?: ProcessConfinement;
        startTimeoutMs?: number;
        /** The home folder of a provider account after the first. */
        accountEnvironment?: Readonly<Record<string, string>>;
        /** An interrupt stops the start and the client, also in an uninterruptible caller. */
        interruptibleStart?: boolean;
      } = {},
    ) {
      const driver = requireProviderDriver(provider);
      let transferred = false;
      return yield* Effect.acquireUseRelease(
        providerStep(() =>
          this.#clientFactory
            ? this.#clientFactory(provider, cli, confinement, accountEnvironment)
            : driver.createClient(
                cli,
                this.#requestTimeoutMs,
                accountEnvironment ? { ...this.#credentials, accountEnvironment } : this.#credentials,
                confinement,
              ),
        ),
        (client) =>
          Effect.gen({ self: this }, function* () {
            yield* providerStep(() => {
              this.#bindClient(client);
              client.start();
            });
            const startedAt = performance.now();
            const durationMs = () => Math.round(performance.now() - startedAt);
            const initialize = this.#initializeProviderClient(client, startTimeoutMs);
            // The client's start is uninterruptible, so it runs on its own fiber. An interrupt stops the
            // wait, and the release stops the client, which ends that start.
            const start = interruptibleStart
              ? Effect.forkIn(Effect.exit(initialize), this.#scope).pipe(
                  Effect.flatMap((fiber) => Effect.interruptible(Fiber.join(fiber))),
                  Effect.flatten,
                )
              : initialize;
            yield* start.pipe(
              Effect.tapError((failure) =>
                Effect.sync(() => {
                  const error = this.#withExitDetail(failure.cause);
                  if (isProviderTimeout(error)) this.#countSlowStart(provider, startTimeoutMs);
                  logger.warn("A provider did not start.", {
                    provider,
                    stage: "initialize",
                    durationMs: durationMs(),
                    timeout: isProviderTimeout(error),
                    message: shortenDiagnostic(this.#redactMcp(error instanceof Error ? error.message : String(error))),
                  });
                }),
              ),
            );
            logger.info("A provider answered initialize.", { provider, durationMs: durationMs() });
            const response = yield* client
              .request("account/read", { refreshToken: true }, decodeAccountReadResult)
              .pipe(toProviderOperationFailed);
            const account = response.account;
            if (!account)
              return yield* new ProviderOperationFailed({
                cause: new ProviderSignInError({ message: this.#noAccountMessage(provider) }),
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
    options: { isCurrent?: () => boolean; notifyReady?: boolean; disposals?: number } = {},
  ) {
    // `disposals` is the count from before the caller started the client. `stop()` does not wait
    // for an activation: a client added after its `dispose()` would run on.
    const disposals = options.disposals ?? this.#disposals;
    const disposed = () => this.#hooks.isStopping() || disposals !== this.#disposals;
    return yield* this.#providerActivation.withPermit(
      Effect.gen({ self: this }, function* () {
        const { isCurrent, notifyReady = true } = options;
        const stopCandidate = client.stop().pipe(Effect.catch(() => Effect.void));
        if ((isCurrent && !isCurrent()) || disposed()) {
          yield* stopCandidate;
          return;
        }
        const previousClient = this.#clients.get(provider);
        const previousCli = this.#cli.get(provider);
        const previousAccount = this.#accounts.get(provider);
        const previousActivatedAt = this.#activatedAt.get(provider);
        const wasReleased = this.#released.delete(provider);
        if (!wasReleased && previousClient !== client) this.#countActivation(provider);
        this.#clients.set(provider, client);
        if (previousClient !== client) this.#activatedAt.set(provider, Date.now());
        this.#cli.set(provider, cli);
        this.#accounts.set(provider, account);
        // Another login has its own usage budget, so its first reading does not wait for the old one's gate.
        if (
          previousAccount &&
          (previousAccount.type !== account.type ||
            previousAccount.email !== account.email ||
            previousAccount.planType !== account.planType)
        )
          this.#forgetUsage(provider);
        const restorePrevious = Effect.gen({ self: this }, function* () {
          if (previousClient) this.#clients.set(provider, previousClient);
          else this.#clients.delete(provider);
          if (previousActivatedAt === undefined) this.#activatedAt.delete(provider);
          else this.#activatedAt.set(provider, previousActivatedAt);
          if (previousCli) this.#cli.set(provider, previousCli);
          else this.#cli.delete(provider);
          if (previousAccount) this.#accounts.set(provider, previousAccount);
          else this.#accounts.delete(provider);
          if (client !== previousClient) yield* stopCandidate;
        });
        const updated = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            const freshCatalogs = yield* this.#refreshModelCatalog();
            if (disposed()) return null;
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
        // A `dispose()` during the refresh took the clients in the map: this one, not the previous
        // client that it replaced. Nothing else stops that previous client, so stop both here and
        // put no client back into the disposed runtime. `AgentService.stop` clears the attention
        // and turn state itself, as it does for the clients that `dispose()` hands back.
        if (disposed()) {
          if (this.#clients.get(provider) === client) this.#clients.delete(provider);
          yield* stopCandidate;
          if (previousClient && previousClient !== client)
            yield* previousClient.stop().pipe(Effect.catch(() => Effect.void));
          return;
        }
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
        if (disposed()) return;
        if (provider === "codex") yield* this.#refreshUsage(client).pipe(Effect.ignore, Effect.forkIn(this.#scope));
        if (this.#providerAccounts && provider !== "acp") yield* this.#providerAccounts.checkAll(provider);
        if (notifyReady && !disposed()) yield* this.#hooks.onProvidersReady().pipe(toProviderOperationFailed);
      }),
    );
  }, Effect.uninterruptible);

  /** `signInPending` is false for a check again, which opens no browser page and has no sign-in to cancel. */
  #setProviderConnectionState(provider: AgentProvider, connectionState: "connecting", signInPending: boolean): void {
    const current = this.#status.providers?.find((candidate) => candidate.id === provider);
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: this.#clients.has(provider) ? "available" : (current?.state ?? "checking"),
        version: this.#cli.get(provider)?.version ?? current?.version ?? null,
        message: null,
        email: this.#accounts.get(provider)?.email ?? current?.email ?? null,
        connectionState,
        signInPending,
      }),
    });
  }

  /** What an account check that finds no account reports. */
  #noAccountMessage(provider: AgentProvider): string {
    return (
      this.#customProviderSignInMessage(provider) ??
      sourceText("error.provider.noAuthenticatedAccount", { provider: providerLabel(provider) })
    );
  }

  /** What a provider with no account says, as the start reports it. */
  #signInRequiredMessage(provider: AgentProvider): string {
    return (
      this.#customProviderSignInMessage(provider) ??
      (provider === "pi"
        ? sourceText("error.provider.piSignIn")
        : provider === "muse"
          ? sourceText("error.provider.museSignIn")
          : provider === "inception"
            ? sourceText("error.provider.inceptionSignIn")
            : provider === "deepseek"
              ? sourceText("error.provider.deepseekSignIn")
              : provider === "openrouter"
                ? sourceText("error.provider.openrouterSignIn")
                : agentProviderDescriptor(provider).signInMessage)
    );
  }

  #clearProviderConnectionState(provider: AgentProvider): void {
    const current = this.#status.providers?.find((candidate) => candidate.id === provider);
    if (!current?.connectionState) return;
    const signedOut = !this.#clients.has(provider) && current.state === "sign-in-required";
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: this.#clients.has(provider) ? "available" : current.state,
        version: this.#cli.get(provider)?.version ?? current.version,
        // A canceled sign-in leaves the provider as it was, so the row says again why it waits.
        message: signedOut ? this.#signInRequiredMessage(provider) : null,
        email: this.#accounts.get(provider)?.email ?? current.email ?? null,
      }),
    });
  }

  /**
   * `cliFailed` is for a failure of the CLI itself, such as an update that installed a CLI which does
   * not start. A CLI that stopped before it answered is one as well. Such a provider needs the CLI
   * fixed, not a sign-in, so its status says so. `keepsReleased` counts a provider that the idle timer
   * released as connected, as when its old CLI is still in use.
   */
  #setProviderConnectionFailure(
    provider: AgentProvider,
    error: unknown,
    version?: string | null,
    cliFailed = error instanceof AgentProcessExitError,
    keepsReleased = false,
  ): void {
    const hasActiveClient = this.#clients.has(provider) || (keepsReleased && this.#released.has(provider));
    const fallbackMessage = `OpenBot could not connect ${providerLabel(provider)}. Try again.`;
    const rawMessage = error instanceof Error ? error.message : String(error);
    const timeout = isProviderTimeout(error);
    // A timeout says which stage did not answer, and the row's last error keeps it. Only a catalog
    // text replaces the fallback: a request timeout names a protocol method in English.
    if (timeout) this.#recordProviderError(provider, error);
    const message =
      (timeout && matchingSourceKeys(rawMessage).length > 0) ||
      error instanceof ProviderSignInError ||
      /^(ChatGPT connection|OpenBot)/u.test(rawMessage)
        ? rawMessage
        : fallbackMessage;
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

  /**
   * Puts a provider back on the binary that is on disk now, after a managed update. A first install
   * whose start did not answer in time stays: the retry that the start scheduled runs it (#3532).
   */
  readonly #reloadProviderCli = Effect.fn("ProviderRuntime.reloadProviderCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    cli: AgentCliInfo,
    firstInstall: boolean,
  ) {
    if (!this.#clients.has(provider)) {
      // A slow start comes from the computer, not the version: the new CLI starts with the wait learned so far.
      const learnedWaitMs = this.#slowStarts.get(provider);
      yield* providerStep(() => {
        this.#clearProviderConnectionState(provider);
        this.#cli.delete(provider);
        // A new CLI gets new starts: the failures were of the one it replaces.
        this.#startFailures.delete(provider);
        this.#slowStarts.delete(provider);
      });
      // Other providers can have live turns. Replacement must not run start recovery.
      yield* this.#connect("starting", [provider], {
        preserveCheckErrors: true,
        notifyReady: false,
        startTimeoutMs: learnedWaitMs ?? this.#longStartTimeoutMs,
      });
      const timedOut = this.#slowStarts.has(provider);
      if (!timedOut && learnedWaitMs !== undefined) this.#slowStarts.set(provider, learnedWaitMs);
      if (firstInstall && timedOut) return;
      const status = this.status().providers?.find((row) => row.id === provider);
      if (status?.version !== cli.version || !["available", "sign-in-required"].includes(status.state)) {
        // The update reason keeps catalog text only, so other text would leave only "Try again.".
        // The log keeps the start failure as the cause.
        const message = status?.message;
        return yield* new ProviderOperationFailed({
          cause:
            message && matchingSourceKeys(message).length > 0
              ? new Error(message)
              : new Error(sourceText("error.provider.cliActivateFailed"), { cause: message }),
        });
      }
      return;
    }
    const disposals = this.#disposals;
    const candidate = yield* this.#authenticateClient(provider, cli, {
      startTimeoutMs: this.#longStartWaitMs(provider),
    });
    yield* this.#activateProviderClient(provider, candidate.client, cli, candidate.account, {
      notifyReady: false,
      disposals,
    }).pipe(toProviderOperationFailed);
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
        this.#setProviderConnectionState(provider, "connecting", false);
        this.#replacingCli.add(provider);
        recordRestartActivity();
      }),
      () =>
        Effect.gen({ self: this }, function* () {
          const disposals = this.#disposals;
          const resolved = yield* this.#resolveProviderCli(provider);
          cli = resolved;
          const candidate = yield* this.#authenticateClient(provider, resolved, {
            startTimeoutMs: this.#longStartWaitMs(provider),
          });
          yield* this.#activateProviderClient(provider, candidate.client, resolved, candidate.account, {
            notifyReady: false,
            disposals,
          }).pipe(toProviderOperationFailed);
          yield* providerStep(() => this.#clearProviderConnectionState(provider));
          return this.status();
        }).pipe(
          // A check that finds no account is an answer, not a failure: a removed key can leave a
          // provider signed out. The process that still runs on the old credential must stop.
          // A sign-in error with its own reason, such as a refused key, keeps that reason.
          Effect.catch((failure) => {
            const cause = failure.cause;
            if (!(cause instanceof ProviderSignInError)) return Effect.fail(failure);
            return Effect.gen({ self: this }, function* () {
              yield* this.#stopProviderClient(provider);
              this.#setProviderConnectionFailure(
                provider,
                cause.message === this.#noAccountMessage(provider)
                  ? new ProviderSignInError({ message: this.#signInRequiredMessage(provider) })
                  : cause,
                cli?.version,
              );
              return this.status();
            });
          }),
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

  /**
   * Stops the client that still runs on a credential that a Reconnect signed out, and reports the
   * provider signed out. A failed sign-in then reports its own reason; a cancel keeps this one.
   */
  readonly #endSignedOutClient = Effect.fn("ProviderRuntime.endSignedOutClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    disposals: number,
  ) {
    if (disposals !== this.#disposals || this.#hooks.isStopping()) return;
    const version = this.#cli.get(provider)?.version;
    yield* this.#stopProviderClient(provider).pipe(Effect.ignore);
    this.#setProviderConnectionFailure(
      provider,
      new ProviderSignInError({ message: this.#signInRequiredMessage(provider) }),
      version,
    );
  });

  #cancelCliLogin(provider: AgentProvider): Effect.Effect<void, ProviderOperationFailed> {
    return this.#cliLogin.cancel(provider, null).pipe(toProviderOperationFailed);
  }

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
    requestedProviders = requestedProviders.filter((provider) => !this.#off.has(provider));
    // A provider OpenBot stopped starting keeps its row as it is, and no process starts.
    const stopped = requestedProviders.filter(
      (provider) => this.#startStopped(provider) && !this.#clients.has(provider),
    );
    for (const provider of stopped) this.#showStartStopped(provider);
    requestedProviders = requestedProviders.filter((provider) => !stopped.includes(provider));
    if (requestedProviders.length === 0) return;
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
        let startTimeoutMs: number | undefined;
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
          // A connect of several providers waits for all of them, as a launch does.
          startTimeoutMs =
            options.startTimeoutMs ?? (requestedProviders.length === 1 ? this.#slowStarts.get(provider) : undefined);
          yield* this.#initializeProviderClient(candidate, startTimeoutMs);
          logger.info("A provider answered initialize.", { provider, durationMs: stageMs() });
          stage = "account";
          stageStartedAt = performance.now();
          const account = yield* candidate
            .request("account/read", { refreshToken: false }, decodeAccountReadResult, 5_000)
            .pipe(toProviderOperationFailed);
          if (!account.account) {
            const message = this.#signInRequiredMessage(provider);
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
          this.#activatedAt.set(provider, Date.now());
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
          if (this.#providerAccounts) yield* this.#providerAccounts.checkAll(provider);
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
                // The process may still be unpacking. The next start waits long enough to finish.
                if (stage === "initialize") this.#countSlowStart(provider, startTimeoutMs);
                if (this.#countStartFailure(provider)) return this.#showStartStopped(provider);
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
              // An expired sign-in fails the account check in the CLI's own words, such as Codex's
              // "workspace routing discovery unauthorized (401)". Ask for a new sign-in instead.
              const failed =
                stage === "account" && classifyUserError(error) === "auth"
                  ? new ProviderSignInError({
                      message: sourceText("error.provider.signInExpired", { provider: providerLabel(provider) }),
                    })
                  : error;
              // The CLI's own words reach the status message and the joined start failure below, so
              // the MCP values go first. `providerFailureStatus` applies only the generic redaction.
              const message = this.#redactMcp(failed instanceof Error ? failed.message : String(failed));
              const failure = providerFailureStatus(provider, failed, cli?.version);
              this.#setStatus({
                providers: updateProviderStatus(this.#status.providers, provider, {
                  ...failure,
                  message: failure.message === null ? null : this.#redactMcp(failure.message),
                }),
              });
              if (!(failed instanceof CodexCliError || failed instanceof ProviderSignInError)) {
                this.#emitProviderError(provider, "start_failed", failed);
                // No process started, and the row keeps the reason the user can act on.
                if (!(failed instanceof ProviderTempDiskSpaceError) && this.#countStartFailure(provider))
                  return this.#showStartStopped(provider);
              }
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
      if (options.notifyReady !== false) yield* this.#hooks.onProvidersReady().pipe(toProviderOperationFailed);
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
      if (client.provider === "codex" && isCodexCredentialFallbackDiagnostic(raw)) {
        logger.info("Codex completed a credential storage fallback.", { provider: client.provider, message });
        return;
      }
      // An agent that tears down its sessions while OpenBot stops it (idle release, restart, quit)
      // can write an error for each one. It is not a failure the user can act on, so it goes to the log.
      if (origin?.duringStop) {
        stderrLogger.warn("A provider wrote an error while OpenBot stopped it.", {
          provider: client.provider,
          message,
        });
        return;
      }
      // Also the name a provider was given. One with no letter or digit, such as `__`, would match
      // every `mcp__server__tool` line.
      const names = new Set(
        [...this.#credentials.mcpServers().map((config) => config.name), ...this.#mcpHandoff.names()].flatMap(
          (name) => {
            const given = providerMcpServerName(name);
            return /[A-Za-z0-9]/u.test(given) ? [name, given] : [name];
          },
        ),
      );
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
      if (client.provider === "grok" && isUsageReadDiagnostic(message)) {
        stderrLogger.warn("A provider reported a failed usage reading.", { provider: client.provider, message });
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
      if (isBundledSandboxFallbackDiagnostic(message)) {
        stderrLogger.warn("A provider uses its bundled bubblewrap.", { provider: client.provider, message });
        return;
      }
      // The usage notice reports the limit only for a provider with a usage reading. Another
      // provider's line goes on to the error below, or nothing on screen would name the limit.
      // Cursor's line goes on too: its reading has no on-demand or team limit.
      if (
        isUsageLimitDiagnostic(message) &&
        client.provider !== "cursor" &&
        agentProviderDescriptor(client.provider).reportsUsage
      ) {
        stderrLogger.warn("A provider reported an exhausted usage limit.", { provider: client.provider, message });
        Effect.runFork(this.refreshUsageAfterLimit(client));
        return;
      }
      if (isGlogBelowErrorDiagnostic(message)) {
        stderrLogger.info("A provider logged an info or warning record.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "antigravity") {
        // Antigravity reports each failure in the protocol: a failed turn in its answer, a refused
        // account as an authentication error, and a crash as the process exit, which keeps the last
        // stderr line. Its stderr repeats them as harness records and Python tracebacks, one
        // "Provider error" toast per line, and a canceled request after each Stop.
        stderrLogger.warn("Gemini logged a diagnostic.", { provider: client.provider, message });
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
    // A process that ran for a while was a good start, and its exit is not one more failure.
    const ranFor = Date.now() - (this.#activatedAt.get(client.provider) ?? 0);
    if (ranFor >= STABLE_RUN_MS) this.#startFailures.delete(client.provider);
    const startStopped = ranFor < STABLE_RUN_MS && this.#countStartFailure(client.provider);
    const attempts = this.#restartAttempts.get(client.provider) ?? 0;
    const stopped = startStopped || attempts >= 3;
    const providers = updateProviderStatus(this.#status.providers, client.provider, {
      state: "error",
      version: this.#cli.get(client.provider)?.version ?? null,
      message: startStopped ? this.#startStoppedMessage(client.provider) : this.#redactMcp(error.message),
    });
    const anotherProviderIsReady = this.#clients.size > 0 || this.#released.size > 0;

    if (stopped) {
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
              message: startStopped
                ? this.#startStoppedMessage(client.provider)
                : `${providerLabel(client.provider)} stopped repeatedly. Restart OpenBot after checking the CLI.`,
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

  /** The wait of a start that may unpack the CLI: the learned wait of a slow provider, else `#longStartTimeoutMs`. */
  #longStartWaitMs(provider: AgentProvider): number {
    return this.#slowStarts.get(provider) ?? this.#longStartTimeoutMs;
  }

  /**
   * Gives the next start of a provider that did not answer `initialize` in `timedOutAfterMs` twice
   * that time: at least `#longStartTimeoutMs` and the wait it has, at most four times
   * `#longStartTimeoutMs`. A start of several providers (undefined) does not shorten the wait.
   */
  #countSlowStart(provider: AgentProvider, timedOutAfterMs: number | undefined): void {
    const nextMs = Math.max(this.#longStartTimeoutMs, this.#slowStarts.get(provider) ?? 0, 2 * (timedOutAfterMs ?? 0));
    this.#slowStarts.set(provider, Math.min(nextMs, 4 * this.#longStartTimeoutMs));
  }

  #startStopped(provider: AgentProvider): boolean {
    return (this.#startFailures.get(provider) ?? 0) >= START_FAILURE_LIMIT;
  }

  /** Counts one failed start, and answers whether OpenBot now stops starting the provider. */
  #countStartFailure(provider: AgentProvider): boolean {
    const failures = (this.#startFailures.get(provider) ?? 0) + 1;
    this.#startFailures.set(provider, failures);
    if (failures < START_FAILURE_LIMIT) return false;
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.delete(provider);
    if (failures === START_FAILURE_LIMIT) logger.warn("OpenBot stopped starting a provider.", { provider, failures });
    return true;
  }

  #startStoppedMessage(provider: AgentProvider): string {
    return sourceText("error.provider.startStopped", { provider: providerLabel(provider) });
  }

  /** Shows on the provider row that OpenBot stopped starting it, and answers the message. */
  #showStartStopped(provider: AgentProvider): string {
    const message = this.#startStoppedMessage(provider);
    const row = this.#status.providers?.find((candidate) => candidate.id === provider);
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: "error",
        version: this.#cli.get(provider)?.version ?? row?.version ?? null,
        message,
      }),
    });
    return message;
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
   * Refreshes the model catalogue, and clears the last error of each provider that answered with a
   * fresh one, when the error is older than the refresh. Answers the providers with a fresh catalogue.
   */
  readonly #refreshModelCatalog = Effect.fn("ProviderRuntime.refreshModelCatalog")(function* (this: ProviderRuntime) {
    const errorSerialAtStart = this.#errorSerial;
    const fresh = yield* this.#modelCatalog.refresh();
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
      .pipe(toProviderOperationFailed);
    if (rateLimits.rateLimitResetCredits !== undefined) {
      const available = rateLimits.rateLimitResetCredits?.availableCount ?? null;
      this.#resetCredits.set(client, available);
      if (this.#clients.get(client.provider) === client) this.#ownResetCredits.set(client.provider, available);
    }
    const usage = normalizeAccountUsage(rateLimits, client.provider === "codex" ? model : undefined);
    // The dock's reading, such as when Codex starts: the gate counts it, so the next poll does not read again.
    if (this.#clients.get(client.provider) === client && model === defaultUsageModel(client.provider)) {
      this.#keepUsage(client.provider, usage);
      this.#usageGate(client.provider).succeeded();
    }
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
const { sync: providerStep, rewrap: toProviderOperationFailed } = causeHelpers(ProviderOperationFailed);

export { toProviderOperationFailed };
