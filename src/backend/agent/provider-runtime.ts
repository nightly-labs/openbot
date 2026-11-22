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
  CustomProviderHarness,
  CustomProviderRestart,
  ProviderAccountCodeLoginStatus,
  ProviderAccountPool,
  ProviderAccountStatus,
  ProviderCodeLoginStart,
  ProviderUsageResetOutcome,
  ProviderUsageResets,
} from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  accountUsageCoversModel,
  agentProviderDescriptor,
  COMPUTER_USE_MCP_SERVER_ID,
  CUSTOM_AGENT_DEFAULT_MODEL,
  CUSTOM_AGENT_LIMITS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  GITHUB_CONNECTOR_MCP_SERVER_ID,
  isAgentProvider,
  isCustomProviderHarness,
  isKeyOnlyProvider,
  usageQuotaForModel,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { classifyFailure } from "@openbot/telemetry";
import { classifyUserError } from "@openbot/user-errors";
import { Deferred, Effect, Exit, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import { isOpenCodeInternalFailure, OPENCODE_INTERNAL_FAILURE } from "./../acp-flavor-opencode";
import { devinSignInPageRelayed, googleSignInByOpenBot, startAcpAuthentication } from "./../acp-sign-in";
import {
  type AgentClient,
  AgentProcessExitError,
  type AgentProvider,
  reportsMissingProcessorFeature,
} from "./../agent-client";
import { AppServerError, CodexAppServerClient } from "./../app-server-client";
import {
  type AgentCliInfo,
  type BundledProviderExecutables,
  CodexCliError,
  chooseInstalledFirst,
  cliPathEnvironment,
  cliSpawnTarget,
} from "./../cli";
import { readCursorUsage } from "./../cursor-usage";
import { DISK_RESTORE_WAIT_MS, diskRestoring, providerCheckTimeoutMs } from "../disk-restore";
import { causeHelpers } from "../effect-boundary";
import { isPythonKimiCli, type SignInRegion } from "../kimi-region";
import { readKimiUsage } from "../kimi-usage";
import { McpHandoffLog } from "./../mcp-handoff-log";
import { grokMcpServerName, providerMcpServerName } from "./../mcp-provider-shapes";
import { customProvidersOn, openCodeSignInMessage } from "./../opencode-config";
import { readOpenCodeGoUsage } from "./../opencode-usage";
import type { ProcessConfinement } from "../process-confinement";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  CLAUDE_API_KEY_ACCOUNT_TYPE,
  CODEX_MODEL_PROVIDER_ACCOUNT_TYPE,
  decodeAccountRateLimitsReadResult,
  decodeAccountRateLimitsUpdated,
  decodeAccountReadResult,
  decodeCodexAccountReadResult,
  decodeRateLimitResetCreditConsumeResult,
  decodeRecordResponse,
  getString,
} from "./../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import {
  antigravityTemp,
  BUILT_IN_PROVIDER_DRIVERS,
  isKeyAccountSupport,
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
import { captureBrowser, signInPageByOpenBot } from "./browser-capture";
import { CliCodeLoginFailed, type CliCodePrompt, PROMPT_TIMEOUT_MS, startCliCodeLogin } from "./cli-code-login";
import { CliLoginFailed, CliLoginFlow, toCliLoginFailed } from "./cli-login-flow";
import { CodexLoginFlow, toCodexLoginFailed } from "./codex-login";
import type { ConversationRuntime } from "./conversation-runtime";
import type { FailureContext } from "./failure-signal";
import { ModelCatalog } from "./model-catalog";
import { startMuseDeviceLogin } from "./muse-login";
import type { PoolCandidate } from "./provider-account-pool";
import type { ProviderAccountStore, StoredProviderAccount } from "./provider-account-store";
import { defaultUsageModel, ownApiKeyNotice, ProviderAccountFailed, ProviderAccounts } from "./provider-accounts";
import {
  createAcpRequestEchoReader,
  isAcpHandlerDiagnostic,
  isGitSpawnDiagnostic,
  isGlogBelowErrorDiagnostic,
  isIgnoredConfigDiagnostic,
  isMcpSessionClosingDiagnostic,
  isMcpSignInDiagnostic,
  isMcpSubsystemDiagnostic,
  isPiWarningDiagnostic,
  isRustLogBelowErrorDiagnostic,
  isTelemetryExportDiagnostic,
  isToolCallDiagnostic,
  isUsageLimitDiagnostic,
  isUsageReadDiagnostic,
  LOG_TIMESTAMP_PREFIX,
  MCP_PROVIDER_FAILURE_TEXT,
  mcpProviderFailureKind,
} from "./provider-diagnostics";
import {
  isProviderTimeout,
  orNewSavedSignIn,
  providerFailureStatus,
  setProviderStatus,
  updateProviderStatus,
  waitForSignInProcess,
  watchSavedSignIn,
} from "./provider-status";
import { hasZeroRealtimeLimit } from "./realtime-limit";
import { providerForAgent, providerLabel } from "./thread-items";
import { UsageReadGate } from "./usage-read-gate";
import { checkAgentFolders, workspaceExcludedFolders, workspaceWritableRoots } from "./workspace-sandbox";

const logger = createOpenBotLogger("provider-runtime");
const stderrLogger = createOpenBotLogger("provider-stderr");

const ACCOUNT_USAGE_READ_TIMEOUT_MS = 30_000;
const CUSTOM_AGENT_USAGE_REUSE_MS = 60_000;
const CUSTOM_AGENT_USAGE_WAKE_MS = 60 * 60_000;
const USAGE_RESET_PROVIDERS: ReadonlySet<AgentProvider> = new Set(["codex"]);

const accountReadDecoder = (provider: AgentProvider) =>
  provider === "codex" ? decodeCodexAccountReadResult : decodeAccountReadResult;
const LONG_START_TIMEOUT_MS = 180_000;
const PROVIDER_IDLE_RELEASE_MS = 10 * 60_000;
const PROVIDER_UNASSIGNED_RELEASE_MS = 60_000;
const PROVIDER_IDLE_CHECK_MS = 60_000;
const LAUNCH_START_CONCURRENCY = 2;
const SIGN_IN_FILE_POLL_MS = 2_000;
const SIGN_IN_RECHECK_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000];

function releasedUsageKey(provider: AgentProvider, model: string): string {
  return `${provider}\u0000${model}`;
}

function signInFileVersion(paths: readonly string[]): string {
  return paths
    .map((path) => {
      try {
        const stats = statSync(path, { throwIfNoEntry: false });
        return stats ? `${stats.ino}:${stats.size}:${stats.mtimeMs}` : "missing";
      } catch {
        return "unreadable";
      }
    })
    .join("|");
}

function fromAnotherDevice(provider: AgentProvider, atHost: boolean): boolean {
  return !(atHost && provider === "antigravity" && process.platform === "win32");
}
const START_FAILURE_LIMIT = 3;
const STABLE_RUN_MS = 2 * 60_000;

function userMustFixStart(reason: string | null | undefined): reason is string {
  return (
    reason === sourceText("error.provider.realtimeLimitZero") ||
    reason === sourceText("error.provider.cpuUnsupported") ||
    reason === sourceText("error.provider.geminiSettingsUnreadable") ||
    reason === sourceText("error.provider.geminiAccountSettingsUnreadable")
  );
}
const CODEX_SERVICE_UNREACHABLE = new Set([
  "workspace routing discovery failed",
  "workspace routing discovery timed out",
]);

function isCodexServiceUnreachable(error: unknown): boolean {
  return error instanceof AppServerError && CODEX_SERVICE_UNREACHABLE.has(error.message);
}
const PROVIDER_RESTART_POLL_MS = 1_000;
const PROVIDER_BACKGROUND_WORK_WAIT_MS = 4 * 60 * 60_000;
const FAILED_MODEL_LIST_RETRY_DELAYS_MS = [2_000, 15_000];
const MODEL_LIST_REREAD_MS = PROVIDER_IDLE_RELEASE_MS;
const OPENCODE_NEWER_DATABASE = /\bDatabase is not empty and has no session table\b/u;
const CODEX_STATE_BUSY = /\btimed out waiting for state db backfill\b/u;
const KILLED_BY_SYSTEM = /\(signal SIGKILL\)/u;
const ILLEGAL_INSTRUCTION = /\(signal SIGILL\)/u;
const SPAWN_ENVIRONMENT_PROVIDERS: readonly AgentProvider[] = [
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "kimi",
  "devin",
  "copilot",
  "mistral",
  "hermes",
  "acp",
];

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

function pushedUsageLimit(provider: AgentProvider, params: unknown): AccountUsage["limits"][number] | null {
  let rateLimits: ReturnType<typeof decodeAccountRateLimitsUpdated>;
  try {
    rateLimits = decodeAccountRateLimitsUpdated(params);
  } catch {
    return null;
  }
  if ((rateLimits.limitId ?? provider) !== provider) return null;
  const { credits, ...windows } = rateLimits;
  const limit = normalizeAccountUsage({
    rateLimits: credits ? rateLimits : windows,
    rateLimitsByLimitId: null,
  }).limits[0];
  return limit && (limit.primary || limit.secondary) ? limit : null;
}

export type AgentClientFactory = (
  provider: AgentProvider,
  cli: AgentCliInfo,
  confinement?: ProcessConfinement,
  accountEnvironment?: Readonly<Record<string, string>>,
) => AgentClient;

interface OwnProcess {
  readonly confinement?: ProcessConfinement;
  readonly account?: StoredProviderAccount;
}

interface ConfinedClient {
  readonly client: AgentClient;
  readonly key: string;
  readonly accountId: string | null;
  lastUsed: number;
}

export interface ProviderHooks {
  bindClient(client: AgentClient): void;
  onProvidersReady(): Effect.Effect<void, ProviderOperationFailed>;
  onProviderLost(client: AgentClient): void;
  onClientStopped(client: AgentClient): Effect.Effect<void>;
  isStopping(): boolean;
  isProviderBusy(provider: AgentProvider): boolean;
  isProviderBusyApartFrom?(provider: AgentProvider, agentId: string): boolean;
  isAgentBusy(agentId: string): boolean;
  isProviderAssigned(provider: AgentProvider): boolean;
  afterIdleCheck?(): Effect.Effect<void>;
  onAgentClientLost(agentId: string, client: AgentClient): Effect.Effect<void>;
  sharedRoot(): string;
  onProviderResumed(provider: AgentProvider): void;
  onProviderHeld?(provider: AgentProvider): void;
  releasePersonWaits?(provider: AgentProvider): void;
  onProviderActivated(provider: AgentProvider, configRevision: number): Effect.Effect<void, ProviderOperationFailed>;
  onAccountModelsListed?(provider: AgentProvider, accountId: string): Effect.Effect<void>;
  onAccountSignedIn?(provider: AgentProvider, accountId: string): Effect.Effect<void>;
  onAccountsChanged?(): void;
  onProvidersUnready?(): void;
  captureConfigRevision(): number;
  endpointsPending?(harness: CustomProviderHarness): boolean;
}

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

export class ProviderRuntime implements ProviderPort {
  readonly #conversation: ConversationRuntime;
  readonly #hooks: ProviderHooks;
  readonly #emit: (event: AgentEvent) => void;
  readonly #emitError: (code: string, error: unknown, agentId?: string, context?: FailureContext) => void;
  readonly #requestTimeoutMs: number;
  readonly #longStartTimeoutMs: number;
  readonly #clientFactory: AgentClientFactory | null;
  readonly #bundledExecutables: BundledProviderExecutables;
  readonly #credentials: ProviderClientContext;
  readonly #clients = new Map<AgentProvider, AgentClient>();
  readonly #confined = new Map<string, ConfinedClient>();
  readonly #confinedStarts = new Map<string, Deferred.Deferred<AgentClient, ProviderOperationFailed>>();
  readonly #activations = new Map<AgentProvider, number>();
  readonly #usageLimitRefreshes = new WeakSet<AgentClient>();
  readonly #mcpHandoff: McpHandoffLog;
  readonly #redactMcp: (text: string) => string;
  readonly #configRevisions = new WeakMap<AgentClient, number>();
  readonly #cli = new Map<AgentProvider, AgentCliInfo>();
  readonly #cliSources = new Map<AgentProvider, Pick<AgentCliInfo, "source" | "incomplete">>();
  readonly #passedOverClis = new Map<
    AgentProvider,
    { source: AgentCliInfo["source"]; version: string; incomplete?: boolean }
  >();
  readonly #accounts = new Map<AgentProvider, AccountReadResult["account"]>();
  readonly #providerStarts = new Map<AgentProvider, Deferred.Deferred<void, ProviderOperationFailed>>();
  #launchStartsPending = false;
  readonly #providerConnectionCommands = new Map<AgentProvider, Deferred.Deferred<void, ProviderOperationFailed>>();
  readonly #replacingCli = new Set<AgentProvider>();
  #removingCustomRuntime = false;
  readonly #released = new Set<AgentProvider>();
  readonly #restartsWhenIdle = new Map<AgentProvider, NodeJS.Timeout | null>();
  readonly #restartsKeepingTurns = new Set<AgentProvider>();
  readonly #restartWaitsSince = new Map<AgentProvider, number>();
  readonly #updatesWhenIdle = new Set<AgentProvider>();
  #customAgentsReloadPending = false;
  readonly #environmentReloadPending = new Set<AgentProvider>();
  readonly #environmentReloadWaitsSince = new Map<AgentProvider, number>();
  readonly #lastUsed = new Map<AgentProvider, number>();
  readonly #compactionModes = new Map<AgentProvider, NonNullable<AgentClient["contextCompaction"]>>();
  readonly #lastErrors = new Map<AgentProvider, { message: string; at: number; serial: number }>();
  #errorSerial = 0;
  readonly #relisting = new Set<AgentProvider>();
  readonly #heldListTimeouts = new Map<AgentProvider, unknown>();
  #modelsReadAt = 0;
  readonly #relistedAfterFailure = new WeakSet<AgentClient>();
  readonly #reportedMcpFailures = new Set<string>();
  readonly #lastUsage = new Map<AgentProvider, AccountUsage["limits"][number]>();
  readonly #poolInUse = new Map<AgentProvider, string | null>();
  readonly #resetCredits = new WeakMap<AgentClient, number | null>();
  readonly #ownResetCredits = new Map<AgentProvider, number | null>();
  readonly #creditsAvailable = new WeakMap<AgentClient, boolean>();
  readonly #usageUnreported = new Set<AgentProvider>();
  readonly #usageGates = new Map<AgentProvider, UsageReadGate>();
  readonly #releasedUsage = new Map<string, { gate: UsageReadGate; usage: AccountUsage }>();
  readonly #customAgentUsage = new Map<string, { prompt: string; text: string | null; readAt: number }>();
  readonly #customAgentUsageLock = Semaphore.makeUnsafe(1);
  #idleCheck: NodeJS.Timeout | null = null;
  readonly #signInFiles = new Map<AgentProvider, { paths: readonly string[]; seen: string }>();
  #signInCheck: NodeJS.Timeout | null = null;
  #status: AgentStatus = structuredClone(INITIAL_STATUS);
  #providerRefresh: Deferred.Deferred<AgentStatus, ProviderOperationFailed> | null = null;
  readonly #codexLogin: CodexLoginFlow;
  readonly #cliLogin: CliLoginFlow;
  #providerActivation = Semaphore.makeUnsafe(1);
  #scope = Scope.makeUnsafe();
  #preferredProvider: AgentProvider;
  #preferredModel: AgentModelId | null;
  readonly #restartAttempts = new Map<AgentProvider, number>();
  readonly #signInRechecks = new Map<AgentProvider, { attempts: number; timer: NodeJS.Timeout | null }>();
  readonly #startFailures = new Map<AgentProvider, number>();
  readonly #startWaitsForUser = new Set<AgentProvider>();
  readonly #slowStarts = new Map<AgentProvider, number>();
  readonly #activatedAt = new Map<AgentProvider, number>();
  readonly #restartTimers = new Map<AgentProvider, NodeJS.Timeout>();
  readonly #exitRecovery = new Set<AgentProvider>();
  #disposals = 0;
  readonly #modelCatalog: ModelCatalog;
  readonly #off: Set<AgentProvider>;
  readonly #saveProviderUse: (provider: AgentProvider, on: boolean) => Effect.Effect<void, ProviderOperationFailed>;
  readonly #installedChosen: Set<AgentProvider>;
  readonly #installedFallback = new Set<AgentProvider>();
  readonly #saveInstalledChoice: (
    provider: AgentProvider,
    installed: boolean,
  ) => Effect.Effect<void, ProviderOperationFailed>;
  readonly #providerAccounts: ProviderAccounts | null;

  constructor(options: {
    offProviders?: readonly AgentProvider[];
    saveProviderUse?: (provider: AgentProvider, on: boolean) => Effect.Effect<void, ProviderOperationFailed>;
    installedCliProviders?: readonly AgentProvider[];
    saveInstalledCliChoice?: (
      provider: AgentProvider,
      installed: boolean,
    ) => Effect.Effect<void, ProviderOperationFailed>;
    conversation: ConversationRuntime;
    hooks: ProviderHooks;
    emit: (event: AgentEvent) => void;
    emitError: (code: string, error: unknown, agentId?: string, context?: FailureContext) => void;
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
    this.#installedChosen = new Set(options.installedCliProviders);
    this.#saveInstalledChoice = options.saveInstalledCliChoice ?? (() => Effect.void);
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
      installedChosen: () => this.#installedChosen.has("codex") || this.#installedFallback.has("codex"),
      createClient: (cli) => {
        const client = this.#clientFactory
          ? this.#clientFactory("codex", cli)
          : new CodexAppServerClient(
              cli.executable,
              this.#requestTimeoutMs,
              cliPathEnvironment(cli),
              this.#credentials.codexTurnContext,
            );
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
          defaultLogin: (provider) => {
            const account = this.#accounts.get(provider);
            return account ? { email: account.email ?? null, organization: account.organization ?? null } : null;
          },
          apiKey: (provider) => this.#credentials.apiKey(provider),
          accountKey: (provider, accountId) => this.#credentials.accountKeys?.get(provider, accountId) ?? null,
          saveAccountKey: (provider, accountId, key) =>
            this.#credentials.accountKeys
              ? this.#credentials.accountKeys
                  .set(provider, accountId, key)
                  .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })))
              : Effect.fail(
                  new ProviderAccountFailed({
                    cause: new Error(
                      sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) }),
                    ),
                  }),
                ),
          defaultUsesApiKey: (provider) => this.ownSignInUsesKey(provider),
          signInTemp: (provider) => {
            const temp = provider === "antigravity" ? antigravityTemp(this.#credentials) : undefined;
            return temp && { ...temp, provider: providerLabel(provider) };
          },
          authenticate: (provider, cli, accountEnvironment, longStart) =>
            this.#authenticateClient(provider, cli, {
              accountEnvironment,
              interruptibleStart: true,
              ...(longStart ? { startTimeoutMs: this.#longStartWaitMs(provider) } : {}),
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
          readModels: (client) =>
            this.#modelCatalog.read(client, requireProviderDriver(client.provider).catalog).pipe(
              Effect.map(({ models }) => models),
              Effect.catch((failure) =>
                Effect.sync(() => {
                  logger.warn("A provider account did not list its models.", {
                    provider: client.provider,
                    timeout: isProviderTimeout(failure.cause),
                  });
                  return null;
                }),
              ),
            ),
          resetCredits: (client) => this.#resetCredits.get(client),
          consumeUsageReset: (client) =>
            this.#consumeUsageReset(client).pipe(
              Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })),
            ),
          changed: () => {
            this.#setStatus({});
            this.#hooks.onAccountsChanged?.();
          },
          modelsListed: (provider, accountId) =>
            (this.#hooks.onAccountModelsListed?.(provider, accountId) ?? Effect.void).pipe(
              Effect.forkIn(this.#scope),
              Effect.asVoid,
            ),
          signedIn: (provider, accountId) => this.#hooks.onAccountSignedIn?.(provider, accountId) ?? Effect.void,
          usageChanged: (limit) => this.#emit({ type: "usage-changed", usage: { limits: [structuredClone(limit)] } }),
          redact: (text) => this.#redactMcp(redactText(text)),
        })
      : null;
    this.#modelCatalog = new ModelCatalog({
      client: (provider) => (this.#off.has(provider) ? undefined : this.#clients.get(provider)),
      isSignedOut: (provider) => this.signInRequired(provider),
      requestTimeoutMs: this.#requestTimeoutMs,
      recordProviderError: (provider, error) => this.#recordProviderError(provider, error),
      startSettingsChanged: (provider) =>
        this.startSettingsChanged(provider).pipe(Effect.ignore, Effect.forkIn(this.#scope), Effect.asVoid),
    });
  }

  accountKind(provider: AgentProvider): { type: string; planType: string | null } | null {
    const account = this.#accounts.get(provider);
    return account ? { type: account.type, planType: account.planType ?? null } : null;
  }

  status(): AgentStatus {
    const status = structuredClone(this.#status);
    if (!status.providers) return status;
    return {
      ...status,
      providers: status.providers.map((row) => {
        if (this.#off.has(row.id)) return { id: row.id, state: "not-started", version: null, message: null, off: true };
        const resolved = this.#cli.get(row.id) ?? this.#cliSources.get(row.id);
        const source = resolved?.source ?? this.#cliSources.get(row.id)?.source;
        const passedOver = this.#passedOverClis.get(row.id);
        const lastError = this.#lastErrors.get(row.id);
        const unverified =
          row.id === "muse" && row.state === "available" && this.#accounts.get(row.id)?.type === "muse-unverified";
        const modelSource = this.#modelCatalog.source(row.id);
        const withSource = {
          ...row,
          ...(unverified
            ? { state: "sign-in-required" as const, message: sourceText("error.provider.museAuthUnverified") }
            : {}),
          ...(source ? { cliSource: source } : {}),
          ...(source === "system" && resolved?.incomplete ? { cliIncomplete: true } : {}),
          ...(passedOver && source && passedOver.source !== source ? { otherCliVersion: passedOver.version } : {}),
          ...(lastError ? { lastError: lastError.message, lastErrorAt: lastError.at } : {}),
          ...(row.id === "antigravity" && this.#credentials.apiKey("antigravity") ? { apiKeyInUse: true } : {}),
          ...(row.id === "codex" && this.#accounts.get("codex")?.type === "apiKey" ? { apiKeyInUse: true } : {}),
          ...(row.id === "muse" && this.#credentials.apiKey("muse") ? { apiKeyInUse: true } : {}),
          ...(modelSource ? { modelSource } : {}),
        };
        const accounts =
          row.state === "available" && row.id !== "acp"
            ? this.#providerAccounts
                ?.rows(row.id, row.email ?? null, ownApiKeyNotice(this.#accounts.get(row.id)))
                ?.map((account) => this.#extraModels(row.id, account))
            : undefined;
        const pool = accounts ? this.accountPool(row.id) : null;
        const liveVoiceAccount = accounts && row.id === "codex" ? this.liveVoiceAccount() : null;
        const withAccounts = accounts
          ? {
              ...withSource,
              accounts,
              ...(pool ? { accountPool: pool } : {}),
              ...(liveVoiceAccount ? { liveVoiceAccount } : {}),
            }
          : withSource;
        const endpointsPending =
          isCustomProviderHarness(row.id) && this.#hooks.endpointsPending
            ? { endpointsPending: this.#hooks.endpointsPending(row.id) }
            : {};
        return this.#restartsWhenIdle.has(row.id)
          ? { ...withAccounts, ...endpointsPending, restartPending: true }
          : { ...withAccounts, ...endpointsPending };
      }),
    };
  }

  lastError(provider: AgentProvider): string | null {
    return this.#lastErrors.get(provider)?.message ?? null;
  }

  requireProviderOn(provider: AgentProvider): void {
    if (this.#off.has(provider))
      throw new Error(sourceText("error.provider.off", { provider: providerLabel(provider) }));
  }

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

  readonly #resolveProviderCli = Effect.fn("ProviderRuntime.resolveCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    { preferInstalled = true }: { preferInstalled?: boolean } = {},
  ) {
    return yield* Effect.gen({ self: this }, function* () {
      yield* providerStep(() => this.requireProviderOn(provider));
      if (provider === "acp" && savedCustomAgents(this.#credentials).length === 0) {
        return yield* new ProviderOperationFailed({
          cause: new CodexCliError(sourceText("error.provider.customAgentNone"), "missing"),
        });
      }
      const driver = requireProviderDriver(provider);
      const cliProvider = driver.cliProvider ?? provider;
      const { cli, passedOver } = yield* chooseInstalledFirst(
        (input) => driver.resolveCli(input),
        this.#bundledExecutables[cliProvider],
        preferInstalled,
        this.#installedChosen.has(cliProvider) || this.#installedFallback.has(cliProvider),
      ).pipe(toProviderOperationFailed);
      this.#cliSources.set(provider, cli);
      if (passedOver) this.#passedOverClis.set(provider, passedOver);
      else this.#passedOverClis.delete(provider);
      return cli;
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          this.#cliSources.delete(provider);
          this.#passedOverClis.delete(provider);
        }),
      ),
    );
  });

  isReady(): boolean {
    return this.#status.phase === "ready";
  }

  signInRequired(provider: AgentProvider): boolean {
    return (
      this.#status.providers?.some((status) => status.id === provider && status.state === "sign-in-required") ?? false
    );
  }

  hasPendingOperation(): boolean {
    return this.#providerStarts.size + this.#providerConnectionCommands.size + this.#replacingCli.size > 0;
  }

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

  currentClient(provider: AgentProvider): AgentClient | null {
    return this.#clients.get(provider) ?? null;
  }

  clientFor(provider: AgentProvider): AgentClient | null {
    const client = this.#clients.get(provider) ?? null;
    if (client) this.#lastUsed.set(provider, Date.now());
    return client;
  }

  readonly #releaseIdleProviders = Effect.fn("ProviderRuntime.releaseIdleProviders")(function* (this: ProviderRuntime) {
    if (this.#hooks.isStopping() || this.#status.phase !== "ready") return;
    if (this.#customAgentsReloadPending && !this.#hooks.isProviderBusy("acp")) yield* this.reloadCustomAgents();
    for (const provider of [...this.#environmentReloadPending]) {
      if (!this.#hooks.isProviderBusy(provider)) yield* this.#reloadAgentEnvironment(provider);
    }
    const now = Date.now();
    for (const [provider, client] of this.#clients) {
      if (client.canReleaseProcess?.() === false) {
        this.#lastUsed.set(provider, now);
        continue;
      }
      if (this.#providerInUse(provider)) {
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
      logger.info("Stopped an idle provider CLI.", { provider });
      yield* this.#releaseClient(provider, client);
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

  #providerInUse(provider: AgentProvider, apartFrom?: string): boolean {
    const busy =
      apartFrom === undefined
        ? this.#hooks.isProviderBusy(provider)
        : (this.#hooks.isProviderBusyApartFrom?.(provider, apartFrom) ?? this.#hooks.isProviderBusy(provider));
    return (
      busy ||
      this.#providerStarts.has(provider) ||
      this.#providerConnectionCommands.has(provider) ||
      this.isReplacingCli(provider) ||
      this.#cliLogin.has(provider) ||
      (provider === "codex" && this.#codexLogin.pending)
    );
  }

  readonly #releaseClient = Effect.fn("ProviderRuntime.releaseClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    client: AgentClient,
  ) {
    this.#clients.delete(provider);
    this.#released.add(provider);
    this.#startFailures.delete(provider);
    this.#conversation.unloadClientThreads(client);
    yield* client.stop().pipe(toProviderOperationFailed).pipe(Effect.ignore);
    yield* this.#hooks.onClientStopped(client);
  });

  readonly releaseSharedProcess = Effect.fn("ProviderRuntime.releaseSharedProcess")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const client = this.#clients.get(provider);
    if (!client || this.#hooks.isStopping() || this.#status.phase !== "ready") return false;
    if (this.keepsSharedProcess(provider)) {
      logger.info("Kept a provider CLI that holds a deleted agent's folder, because work uses it.", { provider });
      return true;
    }
    logger.info("Stopped a provider CLI that holds a deleted agent's folder.", { provider });
    yield* this.#releaseClient(provider, client);
    return false;
  }, Effect.uninterruptible).bind(this);

  readonly releaseFolderProcesses = Effect.fn("ProviderRuntime.releaseFolderProcesses")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    folder: string,
  ) {
    const client = this.#clients.get(provider);
    if (!client?.releaseFolderProcesses || this.#hooks.isStopping() || this.#status.phase !== "ready") return null;
    const kept = yield* client.releaseFolderProcesses(folder);
    if (kept === null) return null;
    logger.info(
      kept
        ? "Kept a provider process that holds a deleted agent's folder, because work uses it."
        : "Stopped the provider processes that hold a deleted agent's folder.",
      { provider },
    );
    return kept;
  }, Effect.uninterruptible).bind(this);

  keepsSharedProcess(provider: AgentProvider): boolean {
    const client = this.#clients.get(provider);
    return client !== undefined && (client.canReleaseProcess?.() === false || this.#providerInUse(provider));
  }

  #holdsBackgroundWork(provider: AgentProvider, waitingSince: number): boolean {
    if (Date.now() - waitingSince >= PROVIDER_BACKGROUND_WORK_WAIT_MS) return false;
    return this.#clients.get(provider)?.runsBackgroundWork?.() === true;
  }

  readonly releaseIdleThreads = Effect.fn("ProviderRuntime.releaseIdleThreads")(function* (this: ProviderRuntime) {
    for (const client of this.#clients.values()) if (client.releaseIdleThreads) yield* client.releaseIdleThreads();
    for (const { client } of this.#confined.values()) if (client.releaseIdleThreads) yield* client.releaseIdleThreads();
  }).bind(this);

  readonly releaseQuietBackgroundThreads = Effect.fn("ProviderRuntime.releaseQuietBackgroundThreads")(function* (
    this: ProviderRuntime,
  ) {
    for (const client of this.#clients.values())
      if (client.releaseQuietBackgroundThreads) yield* client.releaseQuietBackgroundThreads();
    for (const { client } of this.#confined.values())
      if (client.releaseQuietBackgroundThreads) yield* client.releaseQuietBackgroundThreads();
  }).bind(this);

  listModels(): AgentModelOption[] {
    return this.#modelCatalog.list().filter((model) => !this.#off.has(model.provider));
  }

  readonly refreshModels = Effect.fn("ProviderRuntime.refreshModels")(function* (this: ProviderRuntime) {
    const fresh = yield* this.#refreshModelCatalog();
    this.#setStatus({});
    return fresh;
  }).bind(this);

  createProfileClient(provider: AgentProvider, accountId?: string): AgentClient {
    return this.#sideClient(provider, accountId, "profile");
  }

  createMediaClient(provider: AgentProvider, accountId?: string): AgentClient {
    return this.#sideClient(provider, accountId, "media");
  }

  #sideClient(provider: AgentProvider, accountId: string | undefined, purpose: "profile" | "media"): AgentClient {
    this.requireProviderOn(provider);
    if (provider === "acp" && this.#removingCustomRuntime)
      throw new Error(sourceText("error.provider.registryRemoveBusy"));
    const cli = this.#cli.get(provider);
    if (!cli || !this.#clients.has(provider)) throw new Error(sourceText("error.provider.connectBeforeProfile"));
    const account = this.#providerAccounts?.account(provider, accountId) ?? null;
    if (account && !this.#providerAccounts?.supported(provider))
      throw new Error(sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) }));
    const accountEnvironment = account ? this.#providerAccounts?.environment(account) : undefined;
    if (this.#clientFactory) return this.#clientFactory(provider, cli, undefined, accountEnvironment);
    const context = accountEnvironment ? { ...this.#credentials, accountEnvironment } : this.#credentials;
    const driver = requireProviderDriver(provider);
    if (purpose === "media" && driver.createMediaClient)
      return driver.createMediaClient(cli, this.#requestTimeoutMs, context);
    if (driver.createProfileClient) return driver.createProfileClient(cli, this.#requestTimeoutMs, context);
    return driver.createClient(cli, this.#requestTimeoutMs, context);
  }

  preferredProvider(): AgentProvider {
    return this.#preferredProvider;
  }

  preferredModel(): AgentModelId | null {
    return this.#preferredModel;
  }

  readonly usage = Effect.fn("ProviderRuntime.usage")(function* (
    this: ProviderRuntime,
    scope?: { provider: AgentProvider; model: string; accountId?: string },
    only?: AgentProvider,
  ) {
    const deadline = Effect.timeoutOrElse({
      duration: ACCOUNT_USAGE_READ_TIMEOUT_MS,
      orElse: () => Effect.fail(new ProviderOperationFailed({ cause: new Error("Usage read timed out.") })),
    });
    if (!scope) {
      const statuses = (this.status().providers ?? []).filter(
        (item) => isAgentProvider(item.id) && !item.off && item.connectionState !== "connecting",
      );
      const available = new Set(statuses.filter((item) => item.state === "available").map((item) => item.id));
      const providers = statuses
        .map((item) => item.id)
        .filter(isAgentProvider)
        .filter(
          (provider) =>
            (only === undefined || provider === only) &&
            (available.has(provider) || ProviderAccounts.support(provider)),
        )
        .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder);
      const collected = new Map<string, AccountUsage["limits"][number]>();
      const logFailure = (provider: AgentProvider) => this.#logUsageFailure(provider);
      const keptReading = (provider: AgentProvider) =>
        this.#usageUnreported.has(provider) ? null : (this.#lastUsage.get(provider) ?? null);
      const readOwn = (provider: AgentProvider) =>
        Effect.gen({ self: this }, function* () {
          let usage: AccountUsage;
          if (provider === "opencode") {
            usage = normalizeAccountUsage(
              yield* readOpenCodeGoUsage(this.#credentials.apiKey("opencode")).pipe(
                toProviderOperationFailed,
                deadline,
              ),
            );
          } else if (provider === "cursor") {
            usage = normalizeAccountUsage(yield* readCursorUsage().pipe(toProviderOperationFailed, deadline));
          } else if (provider === "kimi") {
            const cli = this.#cli.get(provider);
            if (!cli) return null;
            const env = { ...process.env, ...this.#credentials.agentEnvironment?.() };
            usage = normalizeAccountUsage(
              yield* readKimiUsage(isPythonKimiCli(cli), env).pipe(toProviderOperationFailed, deadline),
            );
          } else {
            if (!agentProviderDescriptor(provider).reportsUsage) return null;
            const codexType = provider === "codex" ? this.#accounts.get(provider)?.type : undefined;
            if (codexType === "apiKey" || codexType === CODEX_MODEL_PROVIDER_ACCOUNT_TYPE) return null;
            const released = this.#released.has(provider) && !this.#clients.has(provider);
            const accounts = ProviderAccounts.support(provider);
            const releasedCli = this.#releasedUsageCli(provider);
            if (releasedCli) {
              usage = yield* this.#readReleasedUsage(provider, releasedCli, defaultUsageModel(provider)).pipe(deadline);
            } else {
              const kept = released ? this.#lastUsage.get(provider) : undefined;
              if (kept && !usageWindowHasReset(kept)) return kept;
              if (released && this.#usageUnreported.has(provider)) return null;
              if (this.#startPaused(provider)) return keptReading(provider);
              if (!this.#clients.has(provider)) yield* this.ensureProvider(provider);
              const client = this.#clients.get(provider);
              if (!client) return null;
              usage = yield* this.#refreshUsage(client, defaultUsageModel(provider), false).pipe(deadline);
              const first = usage.limits[0];
              const last = this.#lastUsage.get(provider);
              if (
                accounts &&
                !isKeyAccountSupport(accounts) &&
                accounts.usageLeavesSession &&
                last &&
                !first?.primary &&
                !first?.secondary
              )
                return last;
            }
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
          if (only === undefined)
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
          if (only === undefined) this.#emit({ type: "usage-changed", usage: { limits: [...collected.values()] } });
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
    const releasedCli = client ? undefined : this.#releasedUsageCli(scope.provider);
    const read = client
      ? this.#refreshUsage(client, scope.model, false)
      : releasedCli
        ? this.#pacedReleasedUsage(
            scope.provider,
            scope.model,
            this.#readReleasedUsage(scope.provider, releasedCli, scope.model).pipe(deadline),
          )
        : undefined;
    if (!read) return { limits: [] };
    return yield* this.#usageGate(scope.provider).unlessWaiting({
      read,
      waiting: (): AccountUsage => ({ limits: [] }),
    });
  }).bind(this);

  #releasedUsageCli(provider: AgentProvider): AgentCliInfo | undefined {
    const cli = this.#cli.get(provider);
    const accounts = ProviderAccounts.support(provider);
    const codexType = provider === "codex" ? this.#accounts.get(provider)?.type : undefined;
    return this.#released.has(provider) &&
      !this.#clients.has(provider) &&
      !this.#usageUnreported.has(provider) &&
      agentProviderDescriptor(provider).reportsUsage &&
      codexType !== "apiKey" &&
      codexType !== CODEX_MODEL_PROVIDER_ACCOUNT_TYPE &&
      accounts &&
      !isKeyAccountSupport(accounts) &&
      !accounts.usageLeavesSession
      ? cli
      : undefined;
  }

  #pacedReleasedUsage<E, R>(
    provider: AgentProvider,
    model: string,
    read: Effect.Effect<AccountUsage, E, R>,
  ): Effect.Effect<AccountUsage, E, R> {
    const key = releasedUsageKey(provider, model);
    const paced = this.#releasedUsage.get(key) ?? { gate: new UsageReadGate(), usage: { limits: [] } };
    this.#releasedUsage.set(key, paced);
    return paced.gate.run({
      read: read.pipe(
        Effect.tap((usage) =>
          Effect.sync(() => {
            paced.usage = usage;
          }),
        ),
      ),
      kept: () => structuredClone(paced.usage),
    });
  }

  readonly #readReleasedUsage = Effect.fn("ProviderRuntime.readReleasedUsage")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    cli: AgentCliInfo,
    model: string | undefined,
  ) {
    return yield* Effect.acquireUseRelease(
      this.#authenticateClient(provider, cli, { interruptibleStart: true }),
      ({ client }) => this.#refreshUsage(client, model, false),
      ({ client }) =>
        client.stop().pipe(Effect.ignore, Effect.andThen(this.#hooks.onClientStopped(client)), Effect.ignore),
    );
  });

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

  #consumeUsageReset(client: AgentClient) {
    return client
      .request(
        "account/rateLimitResetCredit/consume",
        { idempotencyKey: randomUUID() },
        decodeRateLimitResetCreditConsumeResult,
      )
      .pipe(toProviderOperationFailed);
  }

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
    if (this.#startPaused("acp")) return kept();
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

  #keepUsage(provider: AgentProvider, usage: AccountUsage): void {
    const limit = usage.limits[0];
    if (!limit || (!limit.primary && !limit.secondary)) return;
    this.#usageUnreported.delete(provider);
    this.#lastUsage.set(provider, { ...limit, id: provider });
  }

  #forgetUsage(provider: AgentProvider): void {
    this.#usageGate(provider).reset();
    this.#lastUsage.delete(provider);
    this.#ownResetCredits.delete(provider);
    for (const key of [...this.#releasedUsage.keys()])
      if (key.startsWith(releasedUsageKey(provider, ""))) this.#releasedUsage.delete(key);
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
      () =>
        Effect.runFork(
          Effect.exit(this.#releaseIdleProviders()).pipe(
            Effect.andThen(Effect.exit(this.#hooks.afterIdleCheck?.() ?? Effect.void)),
            Effect.andThen(this.#rereadModels()),
            Effect.forkIn(this.#scope),
          ),
        ),
      PROVIDER_IDLE_CHECK_MS,
    );
    this.#idleCheck.unref?.();
    this.#watchSignInFiles();
    const providers = BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id);
    const canStart = providers.filter((provider) => !this.#off.has(provider) && !this.#startStopped(provider));
    const first = canStart.includes(this.#preferredProvider) ? this.#preferredProvider : canStart[0];
    const others = providers.filter((provider) => provider !== first);
    const othersFollow = others.some((provider) => canStart.includes(provider));
    this.#launchStartsPending = othersFollow;
    const completion = Deferred.makeUnsafe<void, ProviderOperationFailed>();
    let starting: AgentProvider[] = [];
    let startsReleased = false;
    const releaseStarts = Effect.gen({ self: this }, function* () {
      startsReleased = true;
      this.#launchStartsPending = false;
      yield* Deferred.succeed(completion, undefined);
      for (const provider of starting)
        if (this.#providerStarts.get(provider) === completion) this.#providerStarts.delete(provider);
    });
    const exit = yield* Effect.exit(
      Effect.gen({ self: this }, function* () {
        if (first)
          yield* this.#connect(
            "starting",
            [first],
            othersFollow ? { othersFollow, refreshRuntimeInBackground: true, skipReadyHook: true } : {},
          );
        starting = others.filter((provider) => !this.#clients.has(provider) && !this.#providerStarts.has(provider));
        for (const provider of starting) this.#providerStarts.set(provider, completion);
        yield* this.#connect("starting", starting, {
          concurrency: LAUNCH_START_CONCURRENCY,
          afterStarts: releaseStarts,
        });
        if (startsReleased || !othersFollow) return;
        this.#launchStartsPending = false;
        if (this.#clients.size > 0) yield* this.#hooks.onProvidersReady().pipe(toProviderOperationFailed);
      }),
    );
    this.#launchStartsPending = false;
    yield* Deferred.done(completion, exit);
    for (const provider of starting)
      if (this.#providerStarts.get(provider) === completion) this.#providerStarts.delete(provider);
    yield* exit;
  }).bind(this);

  #watchSignInFiles(): void {
    for (const driver of BUILT_IN_PROVIDER_DRIVERS) {
      const paths = driver.signInFiles?.() ?? [];
      if (paths.length > 0 && !this.#signInFiles.has(driver.id))
        this.#signInFiles.set(driver.id, { paths, seen: signInFileVersion(paths) });
    }
    if (this.#signInFiles.size === 0) return;
    this.#signInCheck ??= setInterval(() => this.#checkSignInFiles(), SIGN_IN_FILE_POLL_MS);
    this.#signInCheck.unref?.();
  }

  #checkSignInFiles(): void {
    if (this.#status.phase === "starting" || this.#status.phase === "restarting" || this.#providerRefresh) return;
    for (const [provider, file] of this.#signInFiles) {
      const row = this.#status.providers?.find((candidate) => candidate.id === provider);
      if (row?.state !== "sign-in-required") continue;
      if (
        this.#cliLogin.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        (provider === "codex" && this.#codexLogin.pending)
      )
        continue;
      const version = signInFileVersion(file.paths);
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
    yield* this.#startProvider(
      provider,
      wake ? { notifyReady: false, startTimeoutMs: this.#longStartWaitMs(provider) } : {},
    );
    if (this.#clients.has(provider)) return;
    const status = this.#status.providers?.find((candidate) => candidate.id === provider);
    return yield* new ProviderOperationFailed({
      cause: new Error(
        status?.message ?? sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) }),
      ),
    });
  }).bind(this);

  readonly refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (
    this: ProviderRuntime,
    options: { automatic: boolean },
  ) {
    if (!options.automatic) this.#startFailures.clear();
    if (
      options.automatic &&
      (this.#codexLogin.pending || this.#cliLogin.size > 0 || this.#providerConnectionCommands.size > 0)
    )
      return this.status();
    if (this.#providerRefresh) return yield* Deferred.await(this.#providerRefresh);
    if (this.#status.phase === "starting" || this.#status.phase === "restarting") return this.status();
    const completion = Deferred.makeUnsafe<AgentStatus, ProviderOperationFailed>();
    this.#providerRefresh = completion;
    const exit = yield* Effect.exit(this.#refreshProviders(options.automatic));
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
    options: {
      notifyReady?: boolean;
      preserveCheckErrors?: boolean;
      refreshRuntimeInBackground?: boolean;
      startTimeoutMs?: number;
    },
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

  readonly connectProvider = Effect.fn("ProviderRuntime.connectProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
    region: SignInRegion = "global",
  ) {
    return yield* this.#connectProvider(provider, openExternal, false, region);
  }).bind(this);

  readonly #connectProvider = Effect.fn("ProviderRuntime.connectProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
    region: SignInRegion = "global",
  ) {
    const state = () => this.#status.providers?.find((row) => row.id === provider)?.state;
    const before = state();
    this.#startFailures.delete(provider);
    const start = this.#providerStarts.get(provider);
    if (start) yield* Deferred.await(start);
    if (start && this.#clients.has(provider) && this.#accounts.has(provider)) return this.status();
    let waited = false;
    while (this.#providerRefresh) {
      waited = true;
      yield* Deferred.await(this.#providerRefresh).pipe(Effect.ignore);
    }
    if (waited && before !== "available" && before !== "checking" && state() === "available") return this.status();
    if (!start && ["starting", "restarting"].includes(this.#status.phase)) return this.status();
    const signIn = requireProviderDriver(provider).signIn;
    return yield* this.#runProviderConnectionCommand(provider, () =>
      this.#signIn(provider, signIn, openExternal, onHost, region),
    );
  });

  readonly #signIn = Effect.fn("ProviderRuntime.signIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    signIn: ReturnType<typeof requireProviderDriver>["signIn"],
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
    region: SignInRegion,
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
              const browser = signInPageByOpenBot(onHost, signIn.command) ? yield* captureBrowser(openExternal) : {};
              const { argv, savedSignIn } = signIn.command;
              const target = cliSpawnTarget(
                cli.executable,
                typeof argv === "function" ? yield* argv(cli, region) : argv,
              );
              const env = { ...process.env, ...signIn.command.env(cli, region), ...browser };
              const watch = yield* watchSavedSignIn(savedSignIn?.(cli, env));
              const child = yield* Effect.acquireRelease(
                Effect.try({
                  try: () =>
                    spawn(target.command, target.args, {
                      cwd: process.cwd(),
                      env,
                      stdio: signIn.command.failureText ? ["ignore", "pipe", "pipe"] : "ignore",
                      shell: false,
                      windowsHide: process.platform === "win32",
                      windowsVerbatimArguments: target.windowsVerbatimArguments,
                    }),
                  catch: (cause) => new CliLoginFailed({ cause }),
                }),
                (child) => stopProcessTree(child).pipe(Effect.orDie),
              );
              return { child, done: orNewSavedSignIn(waitForSignInProcess(child, signIn.command), watch, undefined) };
            }),
          )
          .pipe(toProviderOperationFailed);
        return this.status();
      case "acp-authenticate": {
        const fresh =
          provider === "antigravity" &&
          this.#status.providers?.find((row) => row.id === provider)?.state === "available" &&
          !this.#credentials.apiKey("antigravity");
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
              ...(provider === "antigravity" && googleSignInByOpenBot(onHost)
                ? { openSignInPage: { site: "google", open: openExternal } }
                : {}),
              ...(provider === "devin" && onHost && devinSignInPageRelayed()
                ? { openSignInPage: { site: "devin", open: openExternal } }
                : {}),
            }).pipe(
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
        yield* Effect.tryPromise({
          try: () => openExternal(started.verificationUrlComplete ?? started.verificationUrl),
          catch: (cause) => new ProviderOperationFailed({ cause }),
        }).pipe(Effect.tapError(() => this.#cancelCliLogin(provider).pipe(Effect.ignore)));
        return this.status();
      }
    }
  });

  readonly connectProviderAccount = Effect.fn("ProviderRuntime.connectProviderAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    const signIn = yield* accounts.connect(provider, accountId, openExternal, false).pipe(toProviderOperationFailed);
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

  readonly connectProviderAccountKey = Effect.fn("ProviderRuntime.connectProviderAccountKey")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
    key: string,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.connectKey(provider, accountId, key).pipe(toProviderOperationFailed);
    return this.status();
  }).bind(this);

  readonly signInProviderAccountOnHost = Effect.fn("ProviderRuntime.signInProviderAccountOnHost")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
    openPage: (url: string) => Promise<void>,
    atHost = false,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    const error = yield* Effect.acquireUseRelease(
      accounts
        .connect(provider, accountId, openPage, fromAnotherDevice(provider, atHost))
        .pipe(toProviderOperationFailed),
      (signIn) => signIn.ended,
      (signIn, exit) =>
        Exit.hasInterrupts(exit) ? accounts.cancel(provider, signIn.accountId, signIn.signIn) : Effect.void,
    );
    if (error) return yield* new ProviderOperationFailed({ cause: new Error(error) });
  }).bind(this);

  readonly startProviderAccountCodeLogin = Effect.fn("ProviderRuntime.startProviderAccountCodeLogin")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string | null,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    const accounts = yield* this.#requireAccounts(provider);
    return yield* accounts.connectWithCode(provider, accountId).pipe(toProviderOperationFailed);
  }).bind(this);

  submitProviderAccountCodeLogin(provider: AgentProvider, accountId: string, code: string): void {
    const accounts = this.#providerAccounts;
    if (!accounts || provider === "acp") throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
    accounts.submitCode(provider, accountId, code);
  }

  providerAccountCodeLoginStatus(provider: AgentProvider, accountId: string): ProviderAccountCodeLoginStatus {
    const accounts = this.#providerAccounts;
    if (accounts && provider !== "acp") return accounts.codeSignInStatus(provider, accountId);
    return {
      result: { error: sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) }) },
    };
  }

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

  readonly setProviderAccountPool = Effect.fn("ProviderRuntime.setProviderAccountPool")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    enabled: boolean,
    leftOut: readonly string[],
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.setPool(provider, enabled, leftOut).pipe(toProviderOperationFailed);
    if (!enabled) this.#poolInUse.delete(provider);
    return this.status();
  }).bind(this);

  readonly setLiveVoiceAccount = Effect.fn("ProviderRuntime.setLiveVoiceAccount")(function* (
    this: ProviderRuntime,
    accountId: string | null,
  ) {
    const accounts = yield* this.#requireAccounts("codex");
    yield* accounts.setLiveVoiceAccount(accountId).pipe(toProviderOperationFailed);
    return this.status();
  }).bind(this);

  liveVoiceAccount(): string | null {
    return this.#providerAccounts?.liveVoiceAccount() ?? null;
  }

  otherCodexAccounts(inUse: string): boolean {
    const ownSignIn =
      this.status().providers?.find((row) => row.id === "codex")?.state === "available" &&
      !this.ownSignInUsesKey("codex");
    const accounts = [
      ...(ownSignIn ? [DEFAULT_PROVIDER_ACCOUNT_ID] : []),
      ...(this.#providerAccounts?.planAccounts("codex") ?? []),
    ];
    return accounts.some((accountId) => accountId !== inUse);
  }

  accountPool(provider: AgentProvider): ProviderAccountPool | null {
    const pool = this.#providerAccounts?.pool(provider);
    if (!pool) return null;
    return { leftOut: [...pool.leftOut], inUse: this.#poolInUse.get(provider) ?? null };
  }

  poolMembers(provider: AgentProvider, model: string): PoolCandidate[] {
    const pool = this.#providerAccounts?.pool(provider);
    if (!pool || !this.#providerAccounts) return [];
    const ownSignIn =
      this.#clients.has(provider) || this.#released.has(provider)
        ? this.status().providers?.find((row) => row.id === provider)?.state === "available" &&
          !this.ownSignInUsesKey(provider)
        : false;
    const members = [
      ...(ownSignIn
        ? [
            {
              accountId: DEFAULT_PROVIDER_ACCOUNT_ID,
              limit: this.#usageUnreported.has(provider) ? null : (this.#lastUsage.get(provider) ?? null),
            },
          ]
        : []),
      ...this.#providerAccounts
        .planAccounts(provider)
        .map((accountId) => ({ accountId, limit: this.#providerAccounts?.keptUsage(accountId) ?? null })),
    ].map(({ accountId, limit }) => ({
      accountId,
      windows: limit ? usageQuotaForModel(limit, model) : undefined,
      namesModels: limit?.groups?.some((group) => group.models.length > 0) === true,
    }));
    const named = members.some((member) => member.namesModels && member.windows !== undefined);
    return members
      .filter((member) => !pool.leftOut.includes(member.accountId))
      .filter((member) => !(named && member.namesModels && member.windows === undefined))
      .map(({ accountId, windows }) => ({
        accountId,
        reading: windows ? { primary: windows.primary, secondary: windows.secondary } : null,
      }));
  }

  setPoolInUse(provider: AgentProvider, accountId: string | null): void {
    if ((this.#poolInUse.get(provider) ?? null) === accountId) return;
    this.#poolInUse.set(provider, accountId);
    this.#setStatus({});
  }

  readPoolUsage(provider: AgentProvider): Effect.Effect<void> {
    return this.usage(undefined, provider).pipe(Effect.ignore);
  }

  readonly removeProviderAccount = Effect.fn("ProviderRuntime.removeProviderAccount")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    accountId: string,
  ) {
    const accounts = yield* this.#requireAccounts(provider);
    yield* accounts.remove(provider, accountId).pipe(toProviderOperationFailed);
    return this.status();
  }, Effect.uninterruptible).bind(this);

  readonly signOutProvider = Effect.fn("ProviderRuntime.signOutProvider")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const accounts = this.#providerAccounts;
    if (!accounts || !ProviderAccounts.signOutCommand(provider))
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.signOutUnsupported", { provider: providerLabel(provider) })),
      });
    const codex = requireProviderDriver(provider).signIn.kind === "browser";
    return yield* this.#runProviderConnectionCommand(provider, () =>
      Effect.gen({ self: this }, function* () {
        if (this.#hooks.isProviderBusy(provider)) {
          return yield* new ProviderOperationFailed({
            cause: new Error(sourceText("error.provider.cliBusySignOut", { provider: providerLabel(provider) })),
          });
        }
        yield* codex ? this.#codexLogin.cancel(null) : this.#cancelCliLogin(provider);
        const disposals = this.#disposals;
        yield* accounts.signOutDefault(provider).pipe(toProviderOperationFailed);
        this.#forgetUsage(provider);
        yield* this.#endSignedOutClient(provider, disposals);
        return this.status();
      }),
    );
  }, Effect.uninterruptible).bind(this);

  hasProviderKey(provider: AgentProvider): boolean {
    return this.#credentials.apiKey(provider) !== null;
  }

  ownSignInUsesKey(provider: AgentProvider): boolean {
    return this.#accounts.get(provider)?.type === CLAUDE_API_KEY_ACCOUNT_TYPE;
  }

  providerKeyChanged(provider: AgentProvider): Effect.Effect<AgentStatus> {
    return (this.#providerAccounts?.keyChanged(provider) ?? Effect.void).pipe(Effect.map(() => this.status()));
  }

  #extraModels(provider: AgentProvider, account: ProviderAccountStatus): ProviderAccountStatus {
    if (!account.models) return account;
    const catalogue = this.#modelCatalog.list().filter((model) => model.provider === provider);
    const models = account.models.filter((model) => !catalogue.some((listed) => listed.id === model.id));
    return { ...account, models };
  }

  accountModels(provider: AgentProvider, accountId: string | undefined): AgentModelOption[] {
    if (this.#off.has(provider)) return [];
    return this.#providerAccounts?.models(provider, accountId) ?? [];
  }

  listedAccountModels(provider: AgentProvider, accountId: string | undefined): AgentModelOption[] | null {
    if (this.#off.has(provider)) return [];
    return this.#providerAccounts?.listedModels(provider, accountId) ?? [];
  }

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

  readonly signInProviderOnHost = Effect.fn("ProviderRuntime.signInProviderOnHost")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    openPage: (url: string) => Promise<void>,
    atHost = false,
  ) {
    yield* this.#connectProvider(provider, openPage, fromAnotherDevice(provider, atHost));
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

  readonly cancelProviderSignIn = Effect.fn("ProviderRuntime.cancelProviderSignIn")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const browser = requireProviderDriver(provider).signIn.kind === "browser";
    return yield* this.#runProviderConnectionCommand(provider, () =>
      (browser ? this.#codexLogin.cancel(null) : this.#cancelCliLogin(provider)).pipe(Effect.map(() => this.status())),
    );
  }).bind(this);

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
    if (codeSignIn.kind === "acp-delegated") {
      const page = Deferred.makeUnsafe<string>();
      const noLink = () => new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) });
      return yield* this.#cliLogin
        .startCode(
          provider,
          (cli) =>
            startAcpAuthentication({
              executable: cli.executable,
              argv: codeSignIn.argv,
              env: { ...codeSignIn.env },
              methodId: codeSignIn.methodId,
              timeoutMs: codeSignIn.timeoutMs,
              onSignInUrl: (url) => Deferred.doneUnsafe(page, Effect.succeed(url)),
            }).pipe(
              Effect.map(({ child, done }) => ({
                child,
                done,
                prompt: Effect.raceFirst(
                  Deferred.await(page).pipe(
                    Effect.map((verificationUrl): CliCodePrompt => ({ flow: "link", verificationUrl })),
                  ),
                  done.pipe(
                    Effect.as(null),
                    Effect.mapError((cause) => new CliCodeLoginFailed({ cause })),
                  ),
                ).pipe(
                  Effect.timeoutOrElse({ duration: PROMPT_TIMEOUT_MS, orElse: () => Effect.fail(noLink()) }),
                  Effect.tapError(() => stopProcessTree(child).pipe(Effect.ignore)),
                ),
                submit() {
                  throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
                },
              })),
            ),
          codeSignIn.timeoutMs,
        )
        .pipe(toProviderOperationFailed);
    }
    const { command, flow } = codeSignIn;
    return yield* this.#cliLogin
      .startCode(
        provider,
        (cli) =>
          Effect.gen(function* () {
            const argv = typeof command.argv === "function" ? yield* command.argv(cli, "global") : command.argv;
            const env = { ...cliPathEnvironment(cli), ...command.env(cli, "global") };
            return yield* startCliCodeLogin({
              flow,
              executable: cli.executable,
              argv,
              env,
              timeoutMs: command.timeoutMs,
              ...(command.closeInput ? { closeInput: true } : {}),
              ...(command.savedSignIn ? { savedSignIn: command.savedSignIn(cli, { ...process.env, ...env }) } : {}),
            });
          }),
        command.timeoutMs,
      )
      .pipe(toProviderOperationFailed);
  }, Effect.uninterruptible);

  submitProviderCodeLogin(provider: AgentProvider, code: string): AgentStatus {
    this.#cliLogin.submit(provider, code);
    return this.status();
  }

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

  #customProviderSignInMessage(provider: AgentProvider): string | null {
    const count =
      provider === "opencode" ? customProvidersOn(this.#credentials.customProviders, "opencode")().length : 0;
    return count > 0 ? openCodeSignInMessage(count) : null;
  }

  readonly reloadCustomProviderConfig = Effect.fn("ProviderRuntime.reloadCustomProviderConfig")(function* (
    this: ProviderRuntime,
    harness: CustomProviderHarness,
  ): Effect.fn.Return<CustomProviderRestart> {
    this.#environmentReloadPending.delete(harness);
    this.#environmentReloadWaitsSince.delete(harness);
    if (!this.#clients.has(harness)) {
      if (this.#released.has(harness))
        yield* this.ensureProvider(harness).pipe(Effect.ignore, Effect.forkIn(this.#scope));
      return "not-running";
    }
    if (this.#hooks.isProviderBusy(harness)) {
      this.#environmentReloadPending.add(harness);
      return "skipped-busy";
    }
    const result = yield* Effect.result(
      this.#runProviderConnectionCommand(harness, () => this.#reprobeProvider(harness)),
    );
    if (Result.isFailure(result) && this.#hooks.isProviderBusy(harness)) {
      this.#environmentReloadPending.add(harness);
      return "skipped-busy";
    }
    return "restarted";
  }, Effect.uninterruptible).bind(this);

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
    const waitingSince = this.#environmentReloadWaitsSince.get(provider) ?? Date.now();
    this.#environmentReloadWaitsSince.delete(provider);
    if (!this.#clients.has(provider)) return;
    if (this.#hooks.isProviderBusy(provider) || this.#holdsBackgroundWork(provider, waitingSince)) {
      this.#environmentReloadPending.add(provider);
      this.#environmentReloadWaitsSince.set(provider, waitingSince);
      return;
    }
    const result = yield* Effect.result(
      this.#runProviderConnectionCommand(provider, () => this.#reprobeProvider(provider)),
    );
    if (Result.isFailure(result) && this.#hooks.isProviderBusy(provider)) this.#environmentReloadPending.add(provider);
  }, Effect.uninterruptible);

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
      if (savedCustomAgents(this.#credentials).length === 0) return "not-running";
      if (this.#released.has("acp")) {
        yield* this.ensureProvider("acp").pipe(Effect.ignore, Effect.forkIn(this.#scope));
        return "not-running";
      }
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

  withCustomAgentRuntimeRemoval<T>(
    operation: () => Effect.Effect<T, ProviderOperationFailed>,
  ): Effect.Effect<T, ProviderOperationFailed> {
    return this.#runProviderConnectionCommand(
      "acp",
      () =>
        Effect.gen({ self: this }, function* () {
          this.#removingCustomRuntime = true;
          this.#replacingCli.add("acp");
          this.#hooks.onProviderHeld?.("acp");
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

  readonly #stopProviderClient = Effect.fn("ProviderRuntime.stopProviderClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const client = this.#clients.get(provider);
    if (client) {
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
    this.#hooks.onProviderHeld?.(provider);
    recordRestartActivity();
    yield* change().pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          this.#replacingCli.delete(provider);
          this.#hooks.onProviderResumed(provider);
        }),
      ),
    );
    this.#countActivation(provider);
    this.#forgetUsage(provider);
    return yield* this.#reprobeProvider(provider);
  }, Effect.uninterruptible);

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
    const waitingSince = Date.now();
    while (true) {
      yield* this.#awaitIdleForUpdate(provider, signal, onWait, waitingSince);
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
    waitingSince: number,
  ) {
    let waitShown = false;
    while (true) {
      if (signal.aborted) return yield* new ProviderOperationFailed({ cause: signal.reason });
      if (this.#hooks.isStopping())
        return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.closing")) });
      const busy = this.#hooks.isProviderBusy(provider);
      if (!busy && !this.#holdsBackgroundWork(provider, waitingSince)) return;
      if (!waitShown && !this.#updatesWhenIdle.has(provider)) onWait();
      waitShown = true;
      if (busy) {
        if (!this.#updatesWhenIdle.has(provider)) {
          this.#updatesWhenIdle.add(provider);
          this.#hooks.onProviderHeld?.(provider);
          recordRestartActivity();
        }
        this.#hooks.releasePersonWaits?.(provider);
      } else if (this.#updatesWhenIdle.delete(provider)) this.#hooks.onProviderResumed(provider);
      yield* Effect.sleep(PROVIDER_RESTART_POLL_MS);
    }
  });

  #endUpdateWhenIdle(provider: AgentProvider): void {
    if (!this.#updatesWhenIdle.delete(provider)) return;
    if (this.#restartsWhenIdle.get(provider) && this.#hooks.isProviderBusy(provider)) {
      this.cancelProviderRestart(provider);
      this.#environmentReloadPending.add(provider);
    }
    this.#hooks.onProviderResumed(provider);
  }

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
    const realtimeLimitZero = sourceText("error.provider.realtimeLimitZero");
    const stoppedByLimit = this.#status.providers?.find((row) => row.id === provider)?.message === realtimeLimitZero;
    if (stoppedByLimit && (yield* providerStep(hasZeroRealtimeLimit)))
      return yield* new ProviderOperationFailed({ cause: new Error(realtimeLimitZero) });
    const previousVersion = this.#cli.get(provider)?.version ?? null;
    const previousExecutable = this.#bundledExecutables[provider];
    const firstInstall = yield* providerStep(
      () => !previousExecutable || !statSync(previousExecutable, { throwIfNoEntry: false }),
    );
    const wasAvailable = this.#status.providers?.find((row) => row.id === provider)?.state === "available";
    let installed = false;
    yield* Effect.acquireUseRelease(
      providerStep(() => {
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
          const cli = yield* this.#resolveProviderCli(provider, { preferInstalled: false });
          if (cli.source !== "managed" || cli.executable !== executable)
            return yield* new ProviderOperationFailed({
              cause: new Error(sourceText("error.provider.cliSelectFailed")),
            });
          yield* this.#reloadProviderCli(provider, cli, firstInstall);
          this.cancelProviderRestart(provider);
          this.#environmentReloadPending.delete(provider);
          this.#environmentReloadWaitsSince.delete(provider);
          this.#installedFallback.delete(provider);
          if (this.#installedChosen.delete(provider))
            yield* this.#saveInstalledChoice(provider, false).pipe(
              Effect.catch(() => Effect.sync(() => logger.warn("The provider CLI choice did not save.", { provider }))),
            );
        }).pipe(
          Effect.mapError((error) => {
            if (previousExecutable === undefined) delete this.#bundledExecutables[provider];
            else this.#bundledExecutables[provider] = previousExecutable;
            const cause = error.cause;
            const failure = new Error(
              sourceText("error.provider.cliUpdateFailed", {
                provider: providerLabel(provider),
                reason:
                  cause instanceof Error && matchingSourceKeys(cause.message).length > 0
                    ? redactText(cause.message)
                    : sourceText("error.provider.tryAgain"),
              }),
              { cause },
            );
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
    for (const driver of BUILT_IN_PROVIDER_DRIVERS) {
      if (driver.cliProvider !== provider || this.#off.has(driver.id)) continue;
      yield* (
        this.#clients.has(driver.id) ? this.restartProviderWhenIdle(driver.id) : this.#reprobeProvider(driver.id)
      ).pipe(Effect.ignore);
    }
    return this.status();
  }, Effect.uninterruptible);

  clientForAgent(agent: AgentSummary): AgentClient | null {
    const confined = this.#confined.get(agent.id);
    if (confined) {
      confined.lastUsed = Date.now();
      return confined.client;
    }
    return this.#ownProcessFor(agent) ? null : this.clientFor(providerForAgent(agent));
  }

  lastCompactionMode(agent: AgentSummary): AgentClient["contextCompaction"] | undefined {
    return this.#compactionModes.get(providerForAgent(agent));
  }

  historyClientForAgent(agent: AgentSummary): AgentClient | null {
    const provider = providerForAgent(agent);
    const account = this.#providerAccounts?.account(provider, agent.providerAccountId);
    if (!account) return this.clientFor(provider);
    const confined = this.#confined.get(agent.id);
    return confined?.accountId === account.id ? confined.client : null;
  }

  runsOnOwnProcess(agentId: string): boolean {
    return this.#confined.has(agentId) || this.#confinedStarts.has(agentId);
  }

  readonly stopAgentProcess = Effect.fn("ProviderRuntime.stopAgentProcess")(function* (
    this: ProviderRuntime,
    agentId: string,
  ) {
    yield* this.#awaitConfinedStart(agentId);
    const confined = this.#confined.get(agentId);
    if (confined) yield* this.#stopConfined(agentId, confined);
  }, Effect.uninterruptible).bind(this);

  readonly #awaitConfinedStart = Effect.fn("ProviderRuntime.awaitConfinedStart")(function* (
    this: ProviderRuntime,
    agentId: string,
  ) {
    for (let pending = this.#confinedStarts.get(agentId); pending; pending = this.#confinedStarts.get(agentId)) {
      const currentStart = pending;
      yield* Deferred.await(currentStart).pipe(Effect.ignore);
    }
  });

  requireReadyClientForAgent(agent: AgentSummary): AgentClient {
    const provider = providerForAgent(agent);
    if (provider === "acp" && this.#removingCustomRuntime)
      throw new Error(sourceText("error.provider.registryRemoveBusy"));
    if (!this.#confined.has(agent.id) && !this.#ownProcessFor(agent)) return this.requireReadyClient(provider);
    const client = this.clientForAgent(agent);
    if (!client) throw new Error(sourceText("error.provider.noAgentProcess", { provider: providerLabel(provider) }));
    return client;
  }

  agentClientCurrent(agent: AgentSummary): boolean {
    const current = this.#confined.get(agent.id);
    if (!current) return true;
    const own = this.#ownProcessFor(agent);
    return own !== null && current.key === this.#confinedKey(providerForAgent(agent), own);
  }

  agentClientRunning(agent: AgentSummary): boolean {
    const provider = providerForAgent(agent);
    if (!this.#clients.has(provider)) return false;
    const own = this.#ownProcessFor(agent);
    return own === null || this.#confined.get(agent.id)?.key === this.#confinedKey(provider, own);
  }

  readonly ensureAgentClient = Effect.fn("ProviderRuntime.ensureAgentClient")(function* (
    this: ProviderRuntime,
    agent: AgentSummary,
  ) {
    const provider = providerForAgent(agent);
    const shared = this.#clients.get(provider);
    if (
      shared &&
      !this.#providerInUse(provider, agent.id) &&
      (yield* this.#mustReplace(shared)) &&
      this.#clients.get(provider) === shared &&
      !this.#providerInUse(provider, agent.id)
    ) {
      logger.info("Replaced a provider CLI that still runs a stopped turn.", { provider });
      yield* this.#releaseClient(provider, shared);
    }
    yield* this.ensureProvider(provider);
    yield* this.#awaitConfinedStart(agent.id);
    if (provider === "acp" && this.#removingCustomRuntime)
      return yield* new ProviderOperationFailed({ cause: new Error(sourceText("error.provider.registryRemoveBusy")) });
    yield* checkAgentFolders(agent);
    const own = this.#ownProcessFor(agent);
    const current = this.#confined.get(agent.id);
    const key = own ? this.#confinedKey(provider, own) : null;
    if (current && current.key === key && !(yield* this.#mustReplace(current.client))) {
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

  #mustReplace(client: AgentClient): Effect.Effect<boolean> {
    return client.replaceForNextTurn?.(this.#conversation.clientThreads(client)) ?? Effect.succeed(false);
  }

  #countActivation(provider: AgentProvider): void {
    this.#activations.set(provider, (this.#activations.get(provider) ?? 0) + 1);
  }

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
    if (own.account && !this.#providerAccounts?.supported(provider))
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.accountsUnsupported", { provider: providerLabel(provider) })),
      });
    const disposals = this.#disposals;
    const accountEnvironment = own.account ? this.#providerAccounts?.environment(own.account) : undefined;
    const { client } = yield* this.#authenticateClient(provider, cli, {
      startTimeoutMs: this.#longStartWaitMs(provider),
      ...(own.confinement ? { confinement: own.confinement } : {}),
      ...(accountEnvironment ? { accountEnvironment } : {}),
    }).pipe(
      Effect.mapError((failure) => {
        const cause = failure.cause;
        if (
          !own.account ||
          !(cause instanceof ProviderSignInError) ||
          cause.message !== this.#noAccountMessage(provider)
        )
          return failure;
        const message = this.#providerAccounts?.foundSignedOut(own.account);
        return message ? new ProviderOperationFailed({ cause: new ProviderSignInError({ message }) }) : failure;
      }),
    );
    if (disposals !== this.#disposals || this.#hooks.isStopping()) {
      yield* client.stop().pipe(Effect.catch(() => Effect.void));
      return yield* new ProviderOperationFailed({
        cause: new Error(sourceText("error.provider.stoppedBeforeAgentProcess", { provider: providerLabel(provider) })),
      });
    }
    this.#confined.set(agentId, { client, key, accountId: own.account?.id ?? null, lastUsed: Date.now() });
    this.#compactionModes.set(provider, client.contextCompaction ?? "unsupported");
    logger.info("Started an agent's own provider process.", {
      provider,
      agentId,
      confined: own.confinement !== undefined,
      account: own.account !== undefined,
    });
    return client;
  }, Effect.uninterruptible);

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

  isReplacingCli(provider: AgentProvider): boolean {
    return (
      this.#replacingCli.has(provider) ||
      (this.#restartsWhenIdle.has(provider) && !this.#restartsKeepingTurns.has(provider)) ||
      this.#updatesWhenIdle.has(provider)
    );
  }

  readonly restartProviderWhenIdle = Effect.fn("ProviderRuntime.restartProviderWhenIdle")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    return yield* this.#restartWhenIdle(provider, true);
  }).bind(this);

  readonly #restartWhenIdle = Effect.fn("ProviderRuntime.restartWhenIdle")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    holdsTurns: boolean,
  ) {
    if (this.#restartsWhenIdle.has(provider)) {
      if (holdsTurns && this.#restartsKeepingTurns.delete(provider)) {
        this.#hooks.onProviderHeld?.(provider);
        this.#setStatus({});
      }
      return this.status();
    }
    this.#startFailures.delete(provider);
    if (!this.#clients.has(provider)) {
      if (this.#released.has(provider)) {
        yield* this.ensureProvider(provider).pipe(toProviderOperationFailed).pipe(Effect.ignore);
        return this.status();
      }
      return yield* this.refreshProvider(provider).pipe(toProviderOperationFailed);
    }
    yield* providerStep(() => {
      this.#restartsWhenIdle.set(provider, null);
      this.#restartWaitsSince.set(provider, Date.now());
      if (holdsTurns) this.#hooks.onProviderHeld?.(provider);
      else this.#restartsKeepingTurns.add(provider);
      recordRestartActivity();
      this.#setStatus({});
    });
    yield* this.#checkRestartWhenIdle(provider);
    return this.status();
  }).bind(this);

  readonly spawnSettingsChanged = Effect.fn("ProviderRuntime.spawnSettingsChanged")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    yield* providerStep(() => this.#countActivation(provider));
    return yield* this.restartProviderWhenIdle(provider);
  }).bind(this);

  readonly startSettingsChanged = Effect.fn("ProviderRuntime.startSettingsChanged")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    yield* providerStep(() => this.#countActivation(provider));
    return yield* this.#restartWhenIdle(provider, false);
  }).bind(this);

  readonly chooseInstalledCli = Effect.fn("ProviderRuntime.chooseInstalledCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    installed: boolean,
  ) {
    yield* providerStep(() => this.requireProviderOn(provider));
    this.#installedFallback.delete(provider);
    if (installed !== this.#installedChosen.has(provider)) {
      yield* this.#saveInstalledChoice(provider, installed);
      if (installed) this.#installedChosen.add(provider);
      else this.#installedChosen.delete(provider);
    }
    return yield* this.restartProviderWhenIdle(provider);
  }).bind(this);

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
      (this.#restartsKeepingTurns.has(provider) &&
        this.#holdsBackgroundWork(provider, this.#restartWaitsSince.get(provider) ?? 0)) ||
      this.#providerStarts.has(provider) ||
      this.#providerConnectionCommands.has(provider) ||
      this.#replacingCli.has(provider) ||
      this.#cliLogin.has(provider) ||
      (provider === "codex" && this.#codexLogin.pending);
    if (waiting) {
      if (this.#hooks.isProviderBusy(provider) && !this.#restartsKeepingTurns.has(provider))
        this.#hooks.releasePersonWaits?.(provider);
      const timer = setTimeout(
        () => Effect.runFork(this.#checkRestartWhenIdle(provider).pipe(Effect.forkIn(this.#scope))),
        PROVIDER_RESTART_POLL_MS,
      );
      timer.unref?.();
      this.#restartsWhenIdle.set(provider, timer);
      return;
    }
    this.#restartsWhenIdle.set(provider, null);
    const keptTurns = this.#restartsKeepingTurns.delete(provider);
    if (keptTurns) this.#hooks.onProviderHeld?.(provider);
    const disposals = this.#disposals;
    yield* this.#runProviderConnectionCommand(provider, () =>
      this.#clients.has(provider) ? this.#reprobeProvider(provider).pipe(Effect.asVoid) : Effect.void,
    ).pipe(
      Effect.match({ onSuccess: () => true, onFailure: () => !this.#hooks.isProviderBusy(provider) }),
      Effect.flatMap((done) => {
        if (disposals !== this.#disposals || !this.#restartsWhenIdle.has(provider)) return Effect.void;
        if (done) return Effect.sync(() => this.#endRestartWhenIdle(provider));
        if (keptTurns) {
          this.#restartsKeepingTurns.add(provider);
          this.#hooks.onProviderResumed(provider);
        }
        return this.#checkRestartWhenIdle(provider);
      }),
      Effect.forkIn(this.#scope),
    );
  });

  #endRestartWhenIdle(provider: AgentProvider): void {
    this.#restartsWhenIdle.delete(provider);
    this.#restartWaitsSince.delete(provider);
    this.#restartsKeepingTurns.delete(provider);
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

  setComputerUseCapability(computerUse: CapabilityState): void {
    this.#setStatus({ capabilities: { ...this.#status.capabilities, computerUse } });
  }

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
      ...(pushed.creditsAvailable === undefined ? {} : { creditsAvailable: pushed.creditsAvailable }),
    };
    this.#usageUnreported.delete(provider);
    this.#lastUsage.set(provider, limit);
    this.#noteCredits(source, limit);
    const limits = [...this.#lastUsage]
      .filter(([item]) => !this.#usageUnreported.has(item) && (this.#clients.has(item) || this.#released.has(item)))
      .map(([, item]) => item);
    this.#emit({ type: "usage-changed", usage: structuredClone({ limits }) });
  }

  #noteCredits(client: AgentClient, limit: AccountUsage["limits"][number] | undefined): void {
    const available = limit?.creditsAvailable;
    if (available === undefined || this.#creditsAvailable.get(client) === available) return;
    this.#creditsAvailable.set(client, available);
    this.#emit({ type: "usage-credits-changed" });
  }

  readonly refreshUsageAfterLimit = Effect.fn("ProviderRuntime.refreshUsageAfterLimit")(function* (
    this: ProviderRuntime,
    source: AgentClient,
  ) {
    if (!agentProviderDescriptor(source.provider).reportsUsage) return;
    const client = this.#clients.get(source.provider);
    if (!client || this.#usageLimitRefreshes.has(client)) return;
    this.#usageLimitRefreshes.add(client);
    yield* this.#refreshUsage(client, undefined, false).pipe(
      Effect.tap((usage) =>
        Effect.sync(() => {
          if (usage.limits.length === 0) return;
          if (defaultUsageModel(source.provider) !== undefined) this.#usageGate(source.provider).reset();
          this.#emit({ type: "usage-changed", usage });
        }),
      ),
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => this.#usageLimitRefreshes.delete(client))),
      Effect.forkIn(this.#scope),
    );
  }).bind(this);

  readonly dispose = Effect.fn("ProviderRuntime.dispose")(function* (this: ProviderRuntime) {
    this.#disposals += 1;
    for (const timer of this.#restartTimers.values()) clearTimeout(timer);
    this.#restartTimers.clear();
    for (const provider of [...this.#signInRechecks.keys()]) this.#endSignInRecheck(provider);
    for (const timer of this.#restartsWhenIdle.values()) if (timer) clearTimeout(timer);
    this.#restartsWhenIdle.clear();
    this.#restartsKeepingTurns.clear();
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

  readonly #refreshProviders = Effect.fn("ProviderRuntime.refreshProviders")(function* (
    this: ProviderRuntime,
    automatic: boolean,
  ) {
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
      (provider) => !this.#off.has(provider) && !(automatic && this.#startPaused(provider)),
    );
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
          .request("account/read", { refreshToken: false }, accountReadDecoder(provider), 5_000)
          .pipe(toProviderOperationFailed);
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
        const version = this.#cli.get(provider)?.version ?? null;
        this.#clients.delete(provider);
        this.#cli.delete(provider);
        this.#accounts.delete(provider);
        this.#forgetUsage(provider);
        this.#setStatus({
          providers: updateProviderStatus(this.#status.providers, provider, {
            state: "sign-in-required",
            version,
            message: this.#signInRequiredMessage(provider),
            email: null,
            checkError: null,
          }),
        });
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

  #withExitDetail<E>(error: E): E | AgentProcessExitError {
    if (!(error instanceof AgentProcessExitError)) return error;
    const detailed = error.withDetail(this.#redactMcp);
    if (OPENCODE_NEWER_DATABASE.test(detailed.message))
      return new AgentProcessExitError(sourceText("error.provider.opencodeDatabaseNewer"), null, { cause: detailed });
    if (CODEX_STATE_BUSY.test(detailed.message))
      return new AgentProcessExitError(sourceText("error.provider.codexStateBusy"), null, { cause: detailed });
    if (KILLED_BY_SYSTEM.test(error.message) && hasZeroRealtimeLimit())
      return new AgentProcessExitError(sourceText("error.provider.realtimeLimitZero"), null, { cause: detailed });
    if (reportsMissingProcessorFeature(detailed.message, ILLEGAL_INSTRUCTION.test(error.message)))
      return new AgentProcessExitError(sourceText("error.provider.cpuUnsupported"), null, { cause: detailed });
    return detailed;
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
        accountEnvironment?: Readonly<Record<string, string>>;
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
              .request("account/read", { refreshToken: false }, accountReadDecoder(provider))
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
        this.#compactionModes.set(provider, client.contextCompaction ?? "unsupported");
        if (previousClient !== client) this.#activatedAt.set(provider, Date.now());
        this.#cli.set(provider, cli);
        this.#accounts.set(provider, account);
        if (
          previousAccount &&
          (previousAccount.type !== account.type ||
            previousAccount.email !== account.email ||
            previousAccount.organization !== account.organization ||
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
            if (freshCatalogs.has(provider))
              yield* this.#hooks
                .onProviderActivated(provider, this.#configRevisions.get(client) ?? 0)
                .pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
            return true;
          }),
        );
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

  #noAccountMessage(provider: AgentProvider): string {
    return (
      this.#customProviderSignInMessage(provider) ??
      sourceText("error.provider.noAuthenticatedAccount", { provider: providerLabel(provider) })
    );
  }

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
                : provider === "hermes"
                  ? sourceText("error.provider.hermesSignIn")
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
        message: signedOut ? this.#signInRequiredMessage(provider) : null,
        email: this.#accounts.get(provider)?.email ?? current.email ?? null,
      }),
    });
  }

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
    const readable =
      matchingSourceKeys(rawMessage).length > 0 ||
      error instanceof ProviderSignInError ||
      /^(ChatGPT connection|OpenBot)/u.test(rawMessage);
    if (isProviderTimeout(error) || !readable) this.#recordProviderError(provider, error);
    const message = readable ? redactText(rawMessage) : fallbackMessage;
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

  readonly #reloadProviderCli = Effect.fn("ProviderRuntime.reloadProviderCli")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    cli: AgentCliInfo,
    firstInstall: boolean,
  ) {
    if (!this.#clients.has(provider)) {
      const learnedWaitMs = this.#slowStarts.get(provider);
      yield* providerStep(() => {
        this.#clearProviderConnectionState(provider);
        this.#cli.delete(provider);
        this.#startFailures.delete(provider);
        this.#slowStarts.delete(provider);
        this.#resetRestarts(provider);
      });
      yield* this.#connect("starting", [provider], {
        preserveCheckErrors: true,
        notifyReady: false,
        startTimeoutMs: learnedWaitMs ?? this.#longStartTimeoutMs,
        preferInstalled: false,
      });
      const timedOut = this.#slowStarts.has(provider);
      if (!timedOut && learnedWaitMs !== undefined) this.#slowStarts.set(provider, learnedWaitMs);
      if (firstInstall && timedOut) return;
      const status = this.status().providers?.find((row) => row.id === provider);
      if (status?.message === sourceText("error.provider.codexStateBusy")) return;
      if (status?.message === sourceText("error.provider.realtimeLimitZero")) return;
      if (status?.message === OPENCODE_INTERNAL_FAILURE && this.#restartTimers.has(provider)) return;
      if (status?.version !== cli.version || !["available", "sign-in-required"].includes(status.state)) {
        const message = status?.message;
        return yield* new ProviderOperationFailed({
          cause:
            message && matchingSourceKeys(message).length > 0
              ? new Error(message)
              : new Error(sourceText("error.provider.cliNewVersionNotStarted"), { cause: message }),
        });
      }
      return;
    }
    const disposals = this.#disposals;
    const candidate = yield* this.#authenticateClient(provider, cli, {
      startTimeoutMs: this.#longStartWaitMs(provider),
    }).pipe(
      Effect.catchIf(
        (failure) =>
          failure.cause instanceof ProviderSignInError && failure.cause.message === this.#noAccountMessage(provider),
        () => Effect.succeed(null),
      ),
    );
    if (!candidate) {
      yield* this.#endSignedOutClient(provider, disposals, cli.version);
      return;
    }
    yield* this.#activateProviderClient(provider, candidate.client, cli, candidate.account, {
      notifyReady: false,
      disposals,
    }).pipe(toProviderOperationFailed);
  }, Effect.uninterruptible);

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
        this.#hooks.onProviderHeld?.(provider);
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

  readonly #endSignedOutClient = Effect.fn("ProviderRuntime.endSignedOutClient")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    disposals: number,
    version = this.#cli.get(provider)?.version,
  ) {
    if (disposals !== this.#disposals || this.#hooks.isStopping()) return;
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
      preferInstalled?: boolean;
      concurrency?: number;
      othersFollow?: boolean;
      afterStarts?: Effect.Effect<void>;
      skipReadyHook?: boolean;
    } = {},
  ) {
    requestedProviders = requestedProviders.filter((provider) => !this.#off.has(provider));
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
    const previousVersions = new Map<AgentProvider, string | null>();
    for (const provider of requestedProviders) {
      const current = this.#status.providers?.find((candidate) => candidate.id === provider);
      previousVersions.set(provider, this.#cli.get(provider)?.version ?? current?.version ?? null);
      setProviderStatus(providerStatuses, provider, {
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
          const resolvedCli = yield* this.#resolveProviderCli(provider, {
            preferInstalled: options.preferInstalled ?? true,
          });
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
          startTimeoutMs =
            options.startTimeoutMs ?? (requestedProviders.length === 1 ? this.#slowStarts.get(provider) : undefined);
          yield* this.#initializeProviderClient(candidate, startTimeoutMs ?? this.#defaultStartTimeoutMs(provider));
          logger.info("A provider answered initialize.", { provider, durationMs: stageMs() });
          stage = "account";
          stageStartedAt = performance.now();
          const account = yield* candidate
            .request(
              "account/read",
              { refreshToken: false },
              accountReadDecoder(provider),
              providerCheckTimeoutMs(5_000),
            )
            .pipe(toProviderOperationFailed);
          if (!account.account) {
            const message = this.#signInRequiredMessage(provider);
            this.#startFailures.delete(provider);
            yield* candidate.stop().pipe(Effect.catch(() => Effect.void));
            this.#setStatus({
              providers: updateProviderStatus(this.#status.providers, provider, {
                state: "sign-in-required",
                version: resolvedCli.version,
                message,
                email: null,
              }),
            });
            if (!disposed()) this.#recheckSignIn(provider, this.#released.has(provider));
            return message;
          }
          const authenticated = account.account;
          yield* providerStep(() => driver.validateAccount(authenticated));
          if (disposed()) {
            yield* candidate.stop().pipe(Effect.catch(() => Effect.void));
            return null;
          }
          if (!this.#released.has(provider)) this.#countActivation(provider);
          this.#cli.set(provider, resolvedCli);
          this.#clients.set(provider, candidate);
          this.#compactionModes.set(provider, candidate.contextCompaction ?? "unsupported");
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
                if (stage === "initialize") this.#countSlowStart(provider, startTimeoutMs);
                if (this.#countStartFailure(provider)) return this.#showStartStopped(provider);
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
              const unreachable = provider === "codex" && stage === "account" && isCodexServiceUnreachable(error);
              const retrying = unreachable && this.#scheduleStartRetry(provider, !disposed());
              const failed =
                stage === "account" && classifyUserError(error) === "auth"
                  ? new ProviderSignInError({
                      message: sourceText("error.provider.signInExpired", { provider: providerLabel(provider) }),
                    })
                  : unreachable
                    ? new Error(
                        sourceText(
                          retrying ? "error.provider.serviceUnreachable" : "error.provider.serviceUnreachableRefresh",
                          { provider: providerLabel(provider) },
                        ),
                        { cause: error },
                      )
                    : error;
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
                if (
                  !(failed instanceof ProviderTempDiskSpaceError) &&
                  !unreachable &&
                  this.#countStartFailure(provider, message)
                )
                  return stage === "initialize" && !disposed() && this.#fallBackToInstalledCli(provider, cli)
                    ? message
                    : this.#showStartStopped(provider);
              }
              if (provider === "opencode" && isOpenCodeInternalFailure(failed))
                this.#retryAfterTimeout(provider, !disposed());
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
      { concurrency: options.concurrency ?? "unbounded" },
    );
    if (options.afterStarts) yield* options.afterStarts;
    if (disposed()) return;
    for (const provider of requestedProviders) this.#released.delete(provider);
    const failures = results.filter((message): message is string => message !== null);
    const finalProviderStatuses = structuredClone(this.#status.providers ?? providerStatuses);

    if (this.#clients.size === 0 && this.#released.size > 0) {
      this.#setStatus({ providers: finalProviderStatuses });
      return;
    }
    if (this.#clients.size === 0 && options.othersFollow) {
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
      this.#endSignInRecheck(provider);
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
        if (client && freshCatalogs.has(provider)) {
          yield* this.#hooks
            .onProviderActivated(provider, this.#configRevisions.get(client) ?? 0)
            .pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
        }
      }
      this.#setStatus({});
      if (codexClient) yield* this.#refreshUsage(codexClient).pipe(Effect.ignore, Effect.forkIn(this.#scope));
      if (options.notifyReady !== false && !options.skipReadyHook && !this.#launchStartsPending)
        yield* this.#hooks.onProvidersReady().pipe(toProviderOperationFailed);
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
      const redacted = this.#redactMcp(raw);
      const message = shortenDiagnostic(redacted);
      if (origin?.duringStop) {
        stderrLogger.warn("A provider wrote an error while OpenBot stopped it.", {
          provider: client.provider,
          message,
        });
        return;
      }
      if (isMcpSessionClosingDiagnostic(redacted)) {
        stderrLogger.warn("A provider did not start an MCP server of a closing session.", {
          provider: client.provider,
          message,
        });
        return;
      }
      const mcpServer =
        isMcpSubsystemDiagnostic(message) && !isToolCallDiagnostic(message)
          ? this.#configuredMcpServerIn(redacted)
          : undefined;
      if (mcpServer !== undefined && !mcpServer?.builtIn) {
        const server = mcpServer?.name ?? null;
        stderrLogger.warn("A provider reported an MCP server failure.", { provider: client.provider, server, message });
        if (server && client.provider !== "codex") this.#reportMcpServerFailure(client.provider, server, redacted);
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
      if (client.provider === "grok" && isUsageReadDiagnostic(message)) {
        stderrLogger.warn("A provider reported a failed usage reading.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "grok" && isGitSpawnDiagnostic(message)) {
        stderrLogger.warn("A provider could not start git.", { provider: client.provider, message });
        return;
      }
      if (isAcpHandlerDiagnostic(message)) {
        stderrLogger.warn("A provider logged a request that it answered with an error.", {
          provider: client.provider,
          message,
        });
        return;
      }
      if (
        isUsageLimitDiagnostic(message) &&
        client.provider !== "cursor" &&
        client.provider !== "kimi" &&
        agentProviderDescriptor(client.provider).reportsUsage
      ) {
        stderrLogger.warn("A provider reported an exhausted usage limit.", { provider: client.provider, message });
        Effect.runFork(this.refreshUsageAfterLimit(client));
        return;
      }
      if (client.provider === "codex") {
        stderrLogger.warn("Codex logged a diagnostic.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "hermes") {
        stderrLogger.warn("Hermes logged a diagnostic.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "acp" && origin?.stderr) {
        stderrLogger.warn("A custom agent logged a diagnostic.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "mistral") {
        stderrLogger.warn("Mistral Vibe logged a diagnostic.", { provider: client.provider, message });
        return;
      }
      if (
        isGlogBelowErrorDiagnostic(message) ||
        isRustLogBelowErrorDiagnostic(message) ||
        ((client.provider === "pi" || isKeyOnlyProvider(client.provider)) && isPiWarningDiagnostic(message))
      ) {
        stderrLogger.info("A provider logged an info or warning record.", { provider: client.provider, message });
        return;
      }
      if (client.provider === "antigravity") {
        stderrLogger.warn("Gemini logged a diagnostic.", { provider: client.provider, message });
        return;
      }
      this.#emitProviderError(client.provider, "diagnostic", message.replace(LOG_TIMESTAMP_PREFIX, ""));
    });
    client.on("notification", (notification) => {
      if (notification.method === "configWarning") this.#reportConfigWarning(client, notification.params);
      if (notification.method === "mcpServer/startupStatus/updated") {
        this.#reportMcpStartupStatus(client, notification.params);
      }
      if (notification.method === "error") this.#reportTurnSignedOut(client, notification.params);
    });
    client.once("exit", (error) => this.#handleExit(client, error));
  }

  #reportTurnSignedOut(client: AgentClient, params: unknown): void {
    const expired = sourceText("error.provider.signInExpired", { provider: providerLabel(client.provider) });
    if (getString(params, "message") !== expired) return;
    const accountId = [...this.#confined.values()].find((confined) => confined.client === client)?.accountId;
    const account = accountId ? this.#providerAccounts?.account(client.provider, accountId) : null;
    if (account) this.#providerAccounts?.foundSignedOut(account);
  }

  #reportConfigWarning(client: AgentClient, params: unknown): void {
    const summary = getString(params, "summary");
    if (!summary || !isIgnoredConfigDiagnostic(summary)) return;
    logger.warn("A provider ignored settings in its configuration.", {
      provider: client.provider,
      message: shortenDiagnostic(this.#redactMcp(summary)),
    });
  }

  #reportMcpStartupStatus(client: AgentClient, params: unknown): void {
    const key = getString(params, "name");
    if (getString(params, "status") !== "failed" || !key) return;
    const message = shortenDiagnostic(this.#redactMcp(getString(params, "error") ?? ""));
    const rows = this.#credentials.mcpServers();
    const config =
      rows.find((row) => key === `openbot_${providerMcpServerName(row.name)}`) ??
      rows.find((row) => key === providerMcpServerName(row.name)) ??
      rows.find((row) => key === row.name);
    const builtIn = config?.id === COMPUTER_USE_MCP_SERVER_ID || config?.id === GITHUB_CONNECTOR_MCP_SERVER_ID;
    const server = config && !builtIn ? config.name : null;
    stderrLogger.warn("A provider reported an MCP server failure.", {
      provider: client.provider,
      server: server ?? config?.id ?? null,
      message,
    });
    const githubKey =
      client.provider === "codex" ? `openbot_${providerMcpServerName(config?.name ?? "")}` : config?.name;
    if (config?.id === GITHUB_CONNECTOR_MCP_SERVER_ID && key === githubKey)
      this.#reportGitHubToolsFailure(client.provider);
    if (!server) return;
    const signIn = getString(params, "failureReason") === "reauthenticationRequired" || isMcpSignInDiagnostic(message);
    this.#reportMcpServerFailure(client.provider, server, message, signIn);
  }

  #handleExit(client: AgentClient, exit: Error): void {
    const error = this.#withExitDetail(exit);
    if (this.#handleConfinedExit(client, error)) return;
    if (this.#clients.get(client.provider) !== client || this.#hooks.isStopping()) return;
    this.#clients.delete(client.provider);
    Effect.runFork(client.stop().pipe(Effect.ignore, Effect.forkIn(this.#scope)));
    this.#conversation.clearLoadedThreads();
    this.#hooks.onProviderLost(client);
    this.#exitRecovery.add(client.provider);
    this.#emitProviderError(client.provider, "exited", error);
    const ranFor = Date.now() - (this.#activatedAt.get(client.provider) ?? 0);
    if (ranFor >= STABLE_RUN_MS) this.#startFailures.delete(client.provider);
    const startStopped = ranFor < STABLE_RUN_MS && this.#countStartFailure(client.provider, error.message);
    const attempts = this.#restartAttempts.get(client.provider) ?? 0;
    const stopped = startStopped || attempts >= 3;
    const providers = updateProviderStatus(this.#status.providers, client.provider, {
      state: "error",
      version: this.#cli.get(client.provider)?.version ?? null,
      message: startStopped
        ? this.#startStoppedMessage(client.provider, error.message)
        : this.#redactMcp(error.message),
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
                ? this.#startStoppedMessage(client.provider, error.message)
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

  #longStartWaitMs(provider: AgentProvider): number {
    return this.#slowStarts.get(provider) ?? this.#longStartTimeoutMs;
  }

  #defaultStartTimeoutMs(provider: AgentProvider): number | undefined {
    if (provider === "codex") return this.#longStartTimeoutMs;
    return diskRestoring() ? Math.max(this.#requestTimeoutMs, DISK_RESTORE_WAIT_MS) : undefined;
  }

  #countSlowStart(provider: AgentProvider, timedOutAfterMs: number | undefined): void {
    const nextMs = Math.max(this.#longStartTimeoutMs, this.#slowStarts.get(provider) ?? 0, 2 * (timedOutAfterMs ?? 0));
    this.#slowStarts.set(provider, Math.min(nextMs, 4 * this.#longStartTimeoutMs));
  }

  #startPaused(provider: AgentProvider): boolean {
    return (this.#startFailures.get(provider) ?? 0) >= START_FAILURE_LIMIT && !this.#clients.has(provider);
  }

  #startStopped(provider: AgentProvider): boolean {
    if ((this.#startFailures.get(provider) ?? 0) < START_FAILURE_LIMIT) return false;
    return this.#startWaitsForUser.has(provider);
  }

  #countStartFailure(provider: AgentProvider, reason?: string | null): boolean {
    const failures = (this.#startFailures.get(provider) ?? 0) + 1;
    this.#startFailures.set(provider, failures);
    if (failures < START_FAILURE_LIMIT) return false;
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.delete(provider);
    const waitsForUser = userMustFixStart(reason);
    if (waitsForUser) this.#startWaitsForUser.add(provider);
    else this.#startWaitsForUser.delete(provider);
    if (failures === START_FAILURE_LIMIT || waitsForUser)
      logger.warn("OpenBot stopped starting a provider by itself.", { provider, failures, waitsForUser });
    return true;
  }

  #startStoppedMessage(provider: AgentProvider, reason?: string | null): string {
    if (this.#startWaitsForUser.has(provider) && userMustFixStart(reason)) return reason;
    return sourceText("error.provider.startPaused", { provider: providerLabel(provider) });
  }

  #fallBackToInstalledCli(provider: AgentProvider, cli: AgentCliInfo | null): boolean {
    const cliProvider = requireProviderDriver(provider).cliProvider ?? provider;
    const installed = this.#passedOverClis.get(provider);
    if (
      cli?.source !== "managed" ||
      installed?.source !== "system" ||
      installed.incomplete ||
      this.#installedFallback.has(cliProvider)
    )
      return false;
    logger.warn("OpenBot's provider CLI did not start, so the installed CLI runs.", {
      provider,
      version: cli.version,
      installedVersion: installed.version,
    });
    this.#installedFallback.add(cliProvider);
    this.#startFailures.delete(provider);
    this.#resetRestarts(provider);
    this.#scheduleRestart(provider, 0, true);
    return true;
  }

  #showStartStopped(provider: AgentProvider): string {
    const row = this.#status.providers?.find((candidate) => candidate.id === provider);
    const message = this.#startStoppedMessage(provider, row?.message);
    this.#setStatus({
      providers: updateProviderStatus(this.#status.providers, provider, {
        state: "error",
        version: this.#cli.get(provider)?.version ?? row?.version ?? null,
        message,
      }),
    });
    return message;
  }

  #resetRestarts(provider: AgentProvider): void {
    this.#restartAttempts.delete(provider);
    this.#endSignInRecheck(provider);
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.delete(provider);
  }

  readonly #restart = Effect.fn("ProviderRuntime.restart")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
    afterTimeout = false,
  ) {
    const disposals = this.#disposals;
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

  #retryAfterTimeout(provider: AgentProvider, schedule: boolean): string {
    return sourceText(
      this.#scheduleStartRetry(provider, schedule) ? "error.provider.cliTimedOut" : "error.provider.cliTimedOutRefresh",
      { provider: providerLabel(provider) },
    );
  }

  signInRecheckPending(provider: AgentProvider): boolean {
    return this.#signInRechecks.has(provider);
  }

  #recheckSignIn(provider: AgentProvider, woke: boolean): void {
    const current = this.#signInRechecks.get(provider);
    if ((!current && !woke) || current?.timer) return;
    const attempts = current?.attempts ?? 0;
    const delayMs = SIGN_IN_RECHECK_DELAYS_MS[attempts];
    if (delayMs === undefined) {
      this.#signInRechecks.delete(provider);
      return;
    }
    const timer = setTimeout(() => {
      const recheck = this.#signInRechecks.get(provider);
      if (recheck?.timer !== timer) return;
      recheck.timer = null;
      if (
        this.#hooks.isStopping() ||
        this.#clients.has(provider) ||
        this.#cliLogin.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        (provider === "codex" && this.#codexLogin.pending)
      ) {
        this.#signInRechecks.delete(provider);
        return;
      }
      Effect.runFork(
        this.#startProvider(provider, { preserveCheckErrors: true }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#signInRechecks.get(provider)?.timer === null) this.#signInRechecks.delete(provider);
            }),
          ),
          Effect.ignore,
          Effect.forkIn(this.#scope),
        ),
      );
    }, delayMs);
    timer.unref?.();
    this.#signInRechecks.set(provider, { attempts: attempts + 1, timer });
  }

  #endSignInRecheck(provider: AgentProvider): void {
    const recheck = this.#signInRechecks.get(provider);
    if (recheck?.timer) clearTimeout(recheck.timer);
    this.#signInRechecks.delete(provider);
  }

  #scheduleStartRetry(provider: AgentProvider, schedule: boolean): boolean {
    const attempts = this.#restartAttempts.get(provider) ?? 0;
    if (!schedule || attempts >= 3) return false;
    this.#restartAttempts.set(provider, attempts + 1);
    this.#scheduleRestart(provider, 5_000 * 2 ** attempts, true);
    return true;
  }

  readonly #refreshModelCatalog = Effect.fn("ProviderRuntime.refreshModelCatalog")(function* (this: ProviderRuntime) {
    this.#modelsReadAt = Date.now();
    const errorSerialAtStart = this.#errorSerial;
    const { fresh, timedOut, failed, sourceChanged } = yield* this.#modelCatalog.refresh();
    let changed = false;
    for (const provider of fresh) {
      const lastError = this.#lastErrors.get(provider);
      if (!lastError || lastError.serial > errorSerialAtStart) continue;
      this.#lastErrors.delete(provider);
      changed = true;
    }
    for (const [provider, cause] of timedOut)
      if (this.#relisting.has(provider)) this.#heldListTimeouts.set(provider, cause);
    if (changed || sourceChanged) this.#setStatus({});
    for (const provider of timedOut.keys()) {
      if (this.#relisting.has(provider)) continue;
      this.#relisting.add(provider);
      yield* this.#relistModels(provider).pipe(
        Effect.ensuring(Effect.sync(() => this.#releaseRelisting(provider))),
        Effect.forkIn(this.#scope),
      );
    }
    for (const provider of failed) {
      const client = this.#clients.get(provider);
      if (!client || this.#relistedAfterFailure.has(client)) continue;
      this.#relistedAfterFailure.add(client);
      yield* Effect.gen({ self: this }, function* () {
        for (const delayMs of FAILED_MODEL_LIST_RETRY_DELAYS_MS) {
          yield* Effect.sleep(delayMs);
          if (this.#clients.get(provider) !== client) return;
          if (yield* this.#relistModels(provider)) return;
        }
      }).pipe(Effect.forkIn(this.#scope));
    }
    return fresh;
  });

  readonly #relistModels = Effect.fn("ProviderRuntime.relistModels")(function* (
    this: ProviderRuntime,
    provider: AgentProvider,
  ) {
    const errorSerialAtStart = this.#errorSerial;
    if (!(yield* this.#modelCatalog.relist(provider))) return false;
    const lastError = this.#lastErrors.get(provider);
    if (lastError && lastError.serial <= errorSerialAtStart) this.#lastErrors.delete(provider);
    this.#setStatus({});
    return true;
  });

  readonly #rereadModels = Effect.fn("ProviderRuntime.rereadModels")(function* (this: ProviderRuntime) {
    if (this.#hooks.isStopping() || this.#status.phase !== "ready") return;
    const now = Date.now();
    if (now - this.#modelsReadAt < MODEL_LIST_REREAD_MS) return;
    this.#modelsReadAt = now;
    const providers = [...this.#clients.keys()].filter(
      (provider) =>
        BUILT_IN_PROVIDER_DRIVERS.find((driver) => driver.id === provider)?.catalog?.relistWhileRunning &&
        !this.#off.has(provider) &&
        !this.#relisting.has(provider),
    );
    if (providers.length === 0) return;
    const errorSerialAtStart = this.#errorSerial;
    const listOf = (provider: AgentProvider) =>
      JSON.stringify([
        this.#modelCatalog.list().filter((model) => model.provider === provider),
        this.#modelCatalog.source(provider) ?? null,
      ]);
    let changed = false;
    for (const provider of providers) this.#relisting.add(provider);
    yield* Effect.forEach(
      providers,
      (provider) =>
        Effect.gen({ self: this }, function* () {
          const before = listOf(provider);
          const showHeldTimeout = () => {
            if (!this.#heldListTimeouts.has(provider)) return;
            this.#recordProviderError(provider, this.#heldListTimeouts.get(provider));
            changed = true;
          };
          if (!(yield* this.#modelCatalog.relist(provider, { quiet: true, onQuietFailure: showHeldTimeout }))) return;
          if (listOf(provider) !== before) changed = true;
          const lastError = this.#lastErrors.get(provider);
          if (lastError && lastError.serial <= errorSerialAtStart) {
            this.#lastErrors.delete(provider);
            changed = true;
          }
        }).pipe(Effect.ensuring(Effect.sync(() => this.#releaseRelisting(provider)))),
      { concurrency: "unbounded", discard: true },
    );
    if (changed) this.#setStatus({});
  });

  #releaseRelisting(provider: AgentProvider): void {
    this.#relisting.delete(provider);
    this.#heldListTimeouts.delete(provider);
  }

  #emitProviderError(provider: AgentProvider, kind: string, error: unknown, agentId?: string): void {
    this.#recordProviderError(provider, error);
    let context: FailureContext | undefined;
    if (kind === "exited") {
      const cause = classifyFailure(error);
      context = { causeCode: cause === "unknown" ? "provider_exited" : cause };
    }
    this.#emitError(`${provider}_${kind}`, error, agentId, context);
    this.#setStatus({});
  }

  #configuredMcpServerIn(message: string): { name: string; builtIn: boolean } | null {
    const configs = this.#credentials.mcpServers();
    const builtIn = (id: string) => id === COMPUTER_USE_MCP_SERVER_ID || id === GITHUB_CONNECTOR_MCP_SERVER_ID;
    const bounded = (text: string, before: string, after: string) =>
      new RegExp(`${before}${RegExp.escape(text)}${after}`, "u").test(message);
    const byHost = configs
      .flatMap((config) => {
        const url = config.transport === "http" ? URL.parse(config.url) : null;
        return url?.host && bounded(url.host, "(?<=//|@)", "(?![\\w.-])") ? [{ config, path: url.pathname }] : [];
      })
      .sort((a, b) => b.path.length - a.path.length);
    const byUrl = byHost.find((row) => row.path !== "/" && message.includes(row.path)) ?? byHost[0];
    if (byUrl) return { name: byUrl.config.name, builtIn: builtIn(byUrl.config.id) };
    const word = (text: string) => bounded(text, "(?<![\\w-])", "(?![\\w-])");
    const named = (name: string) => {
      const given = providerMcpServerName(name);
      return (
        (name !== "" && word(name)) || (/[A-Za-z0-9]/u.test(given) && (word(given) || word(grokMcpServerName(given))))
      );
    };
    const config = configs.find((row) => named(row.name));
    if (config) return { name: config.name, builtIn: builtIn(config.id) };
    const handedOff = this.#mcpHandoff.names().find(named);
    return handedOff ? { name: handedOff, builtIn: false } : null;
  }

  #reportMcpServerFailure(
    provider: AgentProvider,
    server: string,
    message: string,
    signIn = isMcpSignInDiagnostic(message),
  ): void {
    const kind = signIn ? "sign_in" : mcpProviderFailureKind(message);
    const key = [provider, server, kind].join("\u0000");
    if (this.#reportedMcpFailures.has(key)) return;
    this.#reportedMcpFailures.add(key);
    this.#emitError(
      "mcp_server_not_started",
      sourceText(MCP_PROVIDER_FAILURE_TEXT[kind], { provider: providerLabel(provider), name: server }),
    );
  }

  #reportGitHubToolsFailure(provider: AgentProvider): void {
    const key = [provider, GITHUB_CONNECTOR_MCP_SERVER_ID].join("\u0000");
    if (this.#reportedMcpFailures.has(key)) return;
    this.#reportedMcpFailures.add(key);
    this.#emitError(
      "mcp_server_not_started",
      sourceText("error.backend.githubToolsNotStarted", { provider: providerLabel(provider) }),
    );
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
    this.#noteCredits(
      client,
      usage.limits.find((limit) => limit.id === client.provider),
    );
    if (this.#clients.get(client.provider) === client && model === defaultUsageModel(client.provider)) {
      this.#keepUsage(client.provider, usage);
      this.#usageGate(client.provider).succeeded();
    }
    if (emit) this.#emit({ type: "usage-changed", usage: structuredClone(usage) });
    return structuredClone(usage);
  });

  #setStatus(patch: Partial<AgentStatus>): void {
    const available: AgentProvider[] = [];
    let unready = false;
    if (patch.providers) {
      logProviderStateChanges(this.#status.providers ?? [], patch.providers, this.#redactMcp);
      for (const row of patch.providers) if (row.state === "not-installed") this.#lastErrors.delete(row.id);
      for (const row of patch.providers) {
        const current = this.#status.providers?.find((candidate) => candidate.id === row.id);
        if (row.state === "available" && current?.state !== "available") available.push(row.id);
        if (current?.state === "available" && current.off !== true && (row.state !== "available" || row.off === true))
          unready = true;
      }
    }
    this.#status = {
      ...this.#status,
      ...patch,
      capabilities: patch.capabilities ?? this.#status.capabilities,
    };
    this.#emit({ type: "status", status: this.status() });
    for (const provider of available) this.#hooks.onProviderResumed(provider);
    if (unready) this.#hooks.onProvidersUnready?.();
  }
}

export class ProviderOperationFailed extends Schema.TaggedError<ProviderOperationFailed>()("ProviderOperationFailed", {
  cause: Schema.Defect(),
}) {}
const { sync: providerStep, rewrap: toProviderOperationFailed } = causeHelpers(ProviderOperationFailed);

export { toProviderOperationFailed };
