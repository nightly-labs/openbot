import { type ChildProcess, spawn } from "node:child_process";
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
  isAgentProvider,
  isReasoningEffort,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { type AgentClient, AgentProcessExitError, type AgentProvider } from "./../agent-client";
import { CodexAppServerClient } from "./../app-server-client";
import {
  type AgentCliInfo,
  type BundledProviderExecutables,
  CodexCliError,
  type CodexCliInfo,
  resolveCodexCli,
} from "./../cli";
import { McpHandoffLog } from "./../mcp-handoff-log";
import { openCodeSignInMessage } from "./../opencode-config";
import { readOpenCodeGoUsage } from "./../opencode-usage";
import type { ProcessConfinement } from "../process-confinement";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  decodeAccountDeviceCodeLoginStartResult,
  decodeAccountLoginStartResult,
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  type ModelListResponse,
} from "./../protocol";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  type ProviderCliCommand,
  type ProviderClientContext,
  requireProviderDriver,
} from "./../provider-drivers";
import { recordRestartActivity } from "../restart-activity";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { withTimeout } from "../with-timeout";
import { normalizeAccountUsage } from "./account-usage";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  isBackgroundRefreshDiagnostic,
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
  PREFERRED_MODEL_ORDER,
} from "./provider-models";
import {
  providerFailureStatus,
  setProviderStatus,
  updateProviderStatus,
  waitForSuccessfulProcess,
} from "./provider-status";
import { providerForAgent, providerLabel } from "./thread-items";

const logger = createOpenBotLogger("provider-runtime");

const CODEX_LOGIN_TIMEOUT_MS = 10 * 60_000;
const ACCOUNT_USAGE_READ_TIMEOUT_MS = 30_000;
/** How long a provider CLI stays running with nothing to do before its process is stopped. */
export const PROVIDER_IDLE_RELEASE_MS = 10 * 60_000;
/**
 * The same for a provider no agent is set to. Every signed-in provider starts at launch to read its
 * models, and an unused OpenCode process alone held about 300 MB for the full idle time.
 */
export const PROVIDER_UNASSIGNED_RELEASE_MS = 60_000;
const PROVIDER_IDLE_CHECK_MS = 60_000;

/**
 * True once a window of a kept reading has passed its reset time, so the reading is stale. Only
 * then does a usage read start a released provider again. `resetsAt` is in seconds.
 */
function usageWindowHasReset(limit: AccountUsage["limits"][number]): boolean {
  const now = Date.now() / 1_000;
  return [limit.primary, limit.secondary].some((window) => window?.resetsAt != null && window.resetsAt <= now);
}

interface PendingCodexLogin {
  client: AgentClient;
  cli: CodexCliInfo;
  loginId: string;
  timer: NodeJS.Timeout;
  completing: boolean;
}

/** A sign-in that is a CLI process the user completes in a browser the CLI opened. */
interface PendingCliLogin {
  child: ChildProcess;
  cli: AgentCliInfo;
  task: Promise<void> | null;
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
  onProvidersReady(): Promise<void>;
  /** The cleanup #handleExit used to inline: prompts, approvals, takeovers, compaction, browser. */
  onProviderLost(client: AgentClient): void;
  /**
   * Runs when the runtime stops a client it used for a reason other than an exit: an idle release,
   * a sign-out that an account refresh found, or a new client for the same provider. `#handleExit`
   * skips such a client, and it can never answer its pending prompts, approvals and browser
   * takeovers, or complete the turns it ran. It runs after the stop, so a request the process sent
   * while it stopped is cleared too.
   */
  onClientStopped(client: AgentClient): void;
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
  onAgentClientLost(agentId: string, client: AgentClient): void;
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
  onProviderActivated(provider: AgentProvider, configRevision: number): void;
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
  readonly #confinedStarts = new Map<string, Promise<AgentClient>>();
  /**
   * Counts the shared clients that replaced another one for a reason other than an idle release: a
   * new CLI, a stored key, the endpoints or the MCP servers. An agent's own process that started
   * before the count changed read the old values, so its next turn starts it again.
   */
  readonly #activations = new Map<AgentProvider, number>();
  readonly #usageLimitRefreshes = new WeakMap<AgentClient, Promise<void>>();
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
  readonly #providerStarts = new Map<AgentProvider, Promise<void>>();
  readonly #providerConnectionCommands = new Map<AgentProvider, Promise<void>>();
  readonly #replacingCli = new Set<AgentProvider>();
  /**
   * Providers whose idle process was stopped to give its memory back. Each one keeps its status,
   * account and models, so every view reads it as connected; `ensureProvider` starts it again.
   */
  readonly #released = new Set<AgentProvider>();
  readonly #lastUsed = new Map<AgentProvider, number>();
  /** The last usage each provider reported, shown for a released provider instead of starting it. */
  readonly #lastUsage = new Map<AgentProvider, AccountUsage["limits"][number]>();
  #idleCheck: NodeJS.Timeout | null = null;
  #status: AgentStatus = structuredClone(INITIAL_STATUS);
  #providerRefresh: Promise<AgentStatus> | null = null;
  #codexLogin: PendingCodexLogin | null = null;
  readonly #cliLogins = new Map<AgentProvider, PendingCliLogin>();
  #providerActivation = Promise.resolve();
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
        return source ? { ...row, cliSource: source } : row;
      }),
    };
  }

  /** Resolve a provider's binary and keep who owns it, whether or not the provider is signed in. */
  async #resolveProviderCli(provider: AgentProvider): Promise<AgentCliInfo> {
    try {
      const cli = await requireProviderDriver(provider).resolveCli({
        bundledExecutable: this.#bundledExecutables[provider],
      });
      this.#cliSources.set(provider, cli.source);
      return cli;
    } catch (error) {
      // Nothing resolved, so there is no owner to name: a kept one would outlive its binary.
      this.#cliSources.delete(provider);
      throw error;
    }
  }

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
      (this.#codexLogin === null ? 0 : 1)
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
  async #releaseIdleProviders(): Promise<void> {
    if (this.#hooks.isStopping() || this.#status.phase !== "ready") return;
    const now = Date.now();
    for (const [provider, client] of this.#clients) {
      if (
        this.#hooks.isProviderBusy(provider) ||
        this.#providerStarts.has(provider) ||
        this.#providerConnectionCommands.has(provider) ||
        this.#replacingCli.has(provider) ||
        this.#cliLogins.has(provider) ||
        (provider === "codex" && this.#codexLogin !== null)
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
      await client.stop().catch(() => undefined);
      this.#hooks.onClientStopped(client);
    }
    for (const [agentId, confined] of this.#confined) {
      if (this.#hooks.isAgentBusy(agentId)) confined.lastUsed = now;
      if (now - confined.lastUsed < PROVIDER_IDLE_RELEASE_MS) continue;
      logger.info("Stopped an idle Workspace only provider process.", { provider: confined.client.provider, agentId });
      await this.#stopConfined(agentId, confined);
    }
  }

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
  async usage(scope?: { provider: AgentProvider; model: string }): Promise<AccountUsage> {
    if (!scope) {
      const available = (this.status().providers ?? []).filter(
        (item) => isAgentProvider(item.id) && item.state === "available" && item.connectionState !== "connecting",
      );
      const providers = available
        .map((item) => item.id)
        .filter(isAgentProvider)
        .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder);
      const collected = new Map<AgentProvider, AccountUsage["limits"][number]>();
      await Promise.all(
        providers.map(async (provider) => {
          try {
            let usage: AccountUsage;
            if (provider === "opencode") {
              // The Go quota is one HTTPS request with the saved key, so do not start OpenCode for it.
              usage = normalizeAccountUsage(
                await withTimeout(
                  readOpenCodeGoUsage(this.#credentials.apiKey("opencode")),
                  ACCOUNT_USAGE_READ_TIMEOUT_MS,
                  "Usage read timed out.",
                ),
              );
            } else {
              const kept = this.#released.has(provider) ? this.#lastUsage.get(provider) : undefined;
              if (kept && !usageWindowHasReset(kept)) {
                collected.set(provider, kept);
                this.#emit({ type: "usage-changed", usage: { limits: [...collected.values()] } });
                return;
              }
              if (!this.#clients.has(provider)) await this.ensureProvider(provider);
              const client = this.#clients.get(provider);
              if (!client) return;
              const model =
                provider === "codex" ? undefined : agentProviderDescriptor(provider).defaultModel || undefined;
              usage = await withTimeout(
                this.#refreshUsage(client, model, false),
                ACCOUNT_USAGE_READ_TIMEOUT_MS,
                "Usage read timed out.",
              );
            }
            const limit = usage.limits[0];
            if (!limit || (!limit.primary && !limit.secondary)) return;
            collected.set(provider, { ...limit, id: provider });
            this.#lastUsage.set(provider, { ...limit, id: provider });
            this.#emit({
              type: "usage-changed",
              usage: { limits: [...collected.values()] },
            });
          } catch (error) {
            logger.warn("Could not read provider usage.", {
              provider,
              message: error instanceof Error ? error.message : "unknown",
            });
          }
        }),
      );
      return { limits: structuredClone([...collected.values()]) };
    }
    const client = this.#clients.get(scope.provider);
    if (!client || !accountUsageCoversModel(scope.provider, scope.model)) return { limits: [] };
    return this.#refreshUsage(client, scope.model, false);
  }

  async start(): Promise<void> {
    this.#idleCheck ??= setInterval(() => void this.#releaseIdleProviders(), PROVIDER_IDLE_CHECK_MS);
    this.#idleCheck.unref?.();
    await this.#connect(
      "starting",
      BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id),
    );
  }

  async setPreferredProvider(provider: AgentProvider, initialized: boolean, model: AgentModelId | null): Promise<void> {
    this.#preferredProvider = provider;
    // The two travel together: a provider chosen without a model means that provider's default, so
    // the model of an earlier choice must not survive the new one.
    this.#preferredModel = model;
    if (!initialized) return;
    await this.ensureProvider(provider).catch(() => undefined);
    const account = this.#accounts.get(provider);
    if (!this.#clients.has(provider) || !account) return;
    this.#setStatus({
      cliVersion: this.#cli.get(provider)?.version ?? null,
      auth: requireProviderDriver(provider).authState(account),
    });
  }

  async ensureProvider(provider: AgentProvider): Promise<void> {
    this.#lastUsed.set(provider, Date.now());
    if (this.#clients.has(provider)) return;
    let start = this.#providerStarts.get(provider);
    if (!start) {
      // Waking a released provider is not a start: `onProvidersReady` is restart recovery, and it
      // would settle the live deliveries of every other provider.
      const wake = this.#released.has(provider);
      start = this.#connect("starting", [provider], wake ? { notifyReady: false } : {}).finally(() => {
        this.#providerStarts.delete(provider);
      });
      this.#providerStarts.set(provider, start);
      recordRestartActivity();
    }
    await start;
    if (this.#clients.has(provider)) return;
    const status = this.#status.providers?.find((candidate) => candidate.id === provider);
    throw new Error(status?.message ?? sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) }));
  }

  refreshProviders(): Promise<AgentStatus> {
    if (this.#providerRefresh) return this.#providerRefresh;
    if (this.#status.phase === "starting" || this.#status.phase === "restarting") {
      return Promise.resolve(this.status());
    }

    const refresh = this.#refreshProviders().finally(() => {
      if (this.#providerRefresh === refresh) this.#providerRefresh = null;
    });
    this.#providerRefresh = refresh;
    return refresh;
  }

  async refreshProvider(provider: AgentProvider): Promise<AgentStatus> {
    if (this.#clients.has(provider)) return this.status();
    let start = this.#providerStarts.get(provider);
    if (!start) {
      start = this.#connect("starting", [provider], {
        preserveCheckErrors: true,
        refreshRuntimeInBackground: true,
      }).finally(() => {
        this.#providerStarts.delete(provider);
      });
      this.#providerStarts.set(provider, start);
      recordRestartActivity();
    }
    await start;
    return this.status();
  }

  /**
   * Signs the user in to one provider, in the way that provider's driver declares. `openExternal`
   * is only reached by a `browser` sign-in, whose login hands back a URL; a `cli-command` sign-in
   * opens its own browser window from the CLI OpenBot spawns, and an `external` sign-in happens
   * outside OpenBot, so Connect only asks the provider again.
   */
  async connectProvider(provider: AgentProvider, openExternal: (url: string) => Promise<void>): Promise<AgentStatus> {
    const start = this.#providerStarts.get(provider);
    if (start) await start;
    if (start && this.#clients.has(provider) && this.#accounts.has(provider)) return this.status();
    if (this.#providerRefresh || (!start && ["starting", "restarting"].includes(this.#status.phase))) {
      return Promise.resolve(this.status());
    }
    const signIn = requireProviderDriver(provider).signIn;
    return this.#runProviderConnectionCommand(provider, async () => {
      switch (signIn.kind) {
        case "browser":
          await this.#cancelCodexLogin(null);
          return this.#startCodexLogin(openExternal);
        case "cli-command":
          await this.#cancelCliLogin(provider, null);
          return this.#startCliLogin(provider, signIn.command);
        case "external":
          // Nothing to spawn: the user signs in with the provider's own CLI in a terminal, and
          // Connect only asks the provider again whether that has happened.
          return this.#reprobeProvider(provider);
      }
    });
  }

  /**
   * Starts a sign-in the user finishes on another device, for a provider that offers one.
   *
   * Runs in the same queue as Connect, and cancels a sign-in already waiting: two live codes for
   * one provider would leave the user reading the dead one. An account already on this computer is
   * not a reason to refuse: asking for a code while signed in is how the user reaches a different
   * account, and the one in use keeps working until the new sign-in finishes.
   */
  async startProviderCodeLogin(provider: AgentProvider): Promise<ProviderCodeLoginStart> {
    if (!agentProviderDescriptor(provider).codeSignIn) {
      throw new Error(sourceText("error.provider.noCodeSignIn", { provider: providerLabel(provider) }));
    }
    const start = this.#providerStarts.get(provider);
    if (start) await start;
    return this.#runProviderConnectionCommand(provider, async () => {
      await this.#cancelCodexLogin(null);
      return this.#startCodexDeviceLogin();
    });
  }

  /** Abandons a code sign-in. The provider is told, so the code cannot be used after this returns. */
  async cancelProviderCodeLogin(provider: AgentProvider): Promise<AgentStatus> {
    if (!agentProviderDescriptor(provider).codeSignIn) return this.status();
    return this.#runProviderConnectionCommand(provider, async () => {
      await this.#cancelCodexLogin(null);
      return this.status();
    });
  }

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
  async reloadOpenCodeConfig(): Promise<CustomProviderRestart> {
    if (!this.#clients.has("opencode")) return "not-running";
    if (this.#hooks.isProviderBusy("opencode")) return "skipped-busy";
    try {
      await this.#runProviderConnectionCommand("opencode", () => this.#reprobeProvider("opencode"));
    } catch {
      // `#reprobeProvider` has already set the failure status and emitted it. It also throws for a
      // turn that started after the check above, which is the same answer: the config waits for the
      // next spawn.
      return this.#hooks.isProviderBusy("opencode") ? "skipped-busy" : "restarted";
    }
    return "restarted";
  }

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
  async changeProviderCredential(provider: AgentProvider, change: () => Promise<void>): Promise<AgentStatus> {
    return this.#runProviderConnectionCommand(provider, async () => {
      await this.#providerStarts.get(provider);
      if (this.#hooks.isProviderBusy(provider)) {
        throw new Error(sourceText("error.provider.cliBusyRetry", { provider: providerLabel(provider) }));
      }
      this.#replacingCli.add(provider);
      recordRestartActivity();
      try {
        await change();
      } catch (error) {
        this.#replacingCli.delete(provider);
        this.#hooks.onProviderResumed(provider);
        throw error;
      }
      return this.#reprobeProvider(provider);
    });
  }

  /** Keeps this provider idle until its managed runtime is installed and activated. */
  async updateProviderCli(provider: AgentProvider, install: () => Promise<string>): Promise<AgentStatus> {
    return this.#runProviderConnectionCommand(provider, async () => {
      await this.#providerStarts.get(provider);
      if ((provider === "codex" && this.#codexLogin) || this.#cliLogins.has(provider)) {
        throw new Error(sourceText("error.provider.cliSigningIn", { provider: providerLabel(provider) }));
      }
      if (this.#hooks.isProviderBusy(provider)) {
        throw new Error(sourceText("error.provider.cliBusyUpdate", { provider: providerLabel(provider) }));
      }
      const previousVersion = this.#cli.get(provider)?.version ?? null;
      const previousExecutable = this.#bundledExecutables[provider];
      this.#setProviderConnectionState(provider, "connecting");
      this.#replacingCli.add(provider);
      recordRestartActivity();
      let installed = false;
      try {
        const executable = await install();
        installed = true;
        this.#bundledExecutables[provider] = executable;
        const cli = await this.#resolveProviderCli(provider);
        if (cli.source !== "managed" || cli.executable !== executable) {
          throw new Error(sourceText("error.provider.cliSelectFailed"));
        }
        await this.#reloadProviderCli(provider, cli);
      } catch (error) {
        this.#bundledExecutables[provider] = previousExecutable;
        const failure = new Error(
          sourceText("error.provider.cliUpdateFailed", {
            provider: providerLabel(provider),
            reason: error instanceof Error ? redactText(error.message) : sourceText("error.provider.tryAgain"),
          }),
          { cause: error },
        );
        // A failed download leaves the previous CLI as it was. An installed CLI that does not start
        // is a broken CLI, which no sign-in fixes.
        this.#setProviderConnectionFailure(provider, failure, previousVersion, installed);
        throw failure;
      } finally {
        this.#replacingCli.delete(provider);
        this.#hooks.onProviderResumed(provider);
      }
      return this.status();
    });
  }

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
  async ensureAgentClient(agent: AgentSummary): Promise<AgentClient> {
    const provider = providerForAgent(agent);
    await this.ensureProvider(provider);
    for (let pending = this.#confinedStarts.get(agent.id); pending; pending = this.#confinedStarts.get(agent.id)) {
      await pending.catch(() => undefined);
    }
    const confinement = this.#confinementFor(agent);
    const current = this.#confined.get(agent.id);
    const key = confinement ? this.#confinedKey(provider, confinement) : null;
    if (current && current.key === key) {
      current.lastUsed = Date.now();
      return current.client;
    }
    if (current) await this.#stopConfined(agent.id, current);
    if (!confinement || !key) return this.requireReadyClient(provider);
    const start = this.#startConfined(agent.id, provider, confinement, key).finally(() => {
      this.#confinedStarts.delete(agent.id);
    });
    this.#confinedStarts.set(agent.id, start);
    return start;
  }

  #countActivation(provider: AgentProvider): void {
    this.#activations.set(provider, (this.#activations.get(provider) ?? 0) + 1);
  }

  /** What a Workspace only agent's own process may write, or null when the agent needs no such process. */
  #confinementFor(agent: AgentSummary): ProcessConfinement | null {
    const provider = providerForAgent(agent);
    if (!workspaceAccessEnforced(agent)) return null;
    if (!requireProviderDriver(provider).confinesProcess) return null;
    return { writableRoots: [agent.workspacePath, this.#hooks.sharedRoot()] };
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

  async #startConfined(
    agentId: string,
    provider: AgentProvider,
    confinement: ProcessConfinement,
    key: string,
  ): Promise<AgentClient> {
    const cli = this.#cli.get(provider);
    if (!cli) throw new Error(sourceText("error.provider.cliNotReady", { provider: providerLabel(provider) }));
    const disposals = this.#disposals;
    const { client } = await this.#createAuthenticatedProviderClient(provider, cli, confinement);
    if (disposals !== this.#disposals || this.#hooks.isStopping()) {
      await client.stop().catch(() => undefined);
      throw new Error(sourceText("error.provider.stoppedBeforeAgentProcess", { provider: providerLabel(provider) }));
    }
    this.#confined.set(agentId, { client, key, lastUsed: Date.now() });
    logger.info("Started a Workspace only provider process.", { provider, agentId });
    return client;
  }

  /** Out of the map before it stops, so the exit reads as expected, not as a crash. */
  async #stopConfined(agentId: string, confined: ConfinedClient): Promise<void> {
    if (this.#confined.get(agentId) === confined) this.#confined.delete(agentId);
    this.#conversation.unloadClientThreads(confined.client);
    await confined.client.stop().catch(() => undefined);
    this.#hooks.onClientStopped(confined.client);
  }

  /** True when `client` was an agent's own process. Its exit restarts nothing; see `onAgentClientLost`. */
  #handleConfinedExit(client: AgentClient, error: Error): boolean {
    const entry = [...this.#confined].find(([, confined]) => confined.client === client);
    if (!entry) return false;
    const [agentId] = entry;
    this.#confined.delete(agentId);
    if (this.#hooks.isStopping()) return true;
    void client.stop().catch(() => undefined);
    this.#conversation.unloadClientThreads(client);
    this.#hooks.onAgentClientLost(agentId, client);
    this.#emitError(`${client.provider}_exited`, new Error(this.#redactMcp(error.message)), agentId);
    return true;
  }

  /** True while a managed runtime is installed and its previous client is replaced. */
  isReplacingCli(provider: AgentProvider): boolean {
    return this.#replacingCli.has(provider);
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
  completeCodexLogin(
    params: unknown,
    source: AgentClient,
    decode: (params: unknown) => AccountLoginCompletedResult,
  ): void {
    try {
      const completion = decode(params);
      void this.#runProviderConnectionCommand("codex", async () => {
        await this.#completeCodexLogin(completion, source);
        return this.status();
      });
    } catch {
      const pending = this.#codexLogin;
      if (pending) void this.#failCodexLogin(pending, "OpenBot could not verify the ChatGPT connection. Try again.");
    }
  }

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
  refreshCodexUsage(): void {
    const client = this.#clients.get("codex");
    if (client) void this.#refreshUsage(client, undefined, false).catch(() => undefined);
  }

  /** Refresh the notice once when one provider reports the same exhausted balance several ways. */
  refreshUsageAfterLimit(source: AgentClient): void {
    const client = this.#clients.get(source.provider);
    if (!client || this.#usageLimitRefreshes.has(client)) return;
    const refresh = this.#refreshUsage(client)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.#usageLimitRefreshes.get(client) === refresh) this.#usageLimitRefreshes.delete(client);
      });
    this.#usageLimitRefreshes.set(client, refresh);
  }

  /**
   * The provider half of stop(). Returns the clients the caller still has to await, because
   * stop() interleaves that wait with the mailbox and image-generation teardown.
   */
  dispose(): AgentClient[] {
    this.#disposals += 1;
    for (const timer of this.#restartTimers.values()) clearTimeout(timer);
    this.#restartTimers.clear();
    if (this.#idleCheck) clearInterval(this.#idleCheck);
    this.#idleCheck = null;
    this.#released.clear();
    const pendingLogin = this.#codexLogin;
    this.#codexLogin = null;
    const cliLogins = [...this.#cliLogins.values()];
    this.#cliLogins.clear();
    this.#providerConnectionCommands.clear();
    for (const login of cliLogins) {
      if (login.child.exitCode === null) login.child.kill("SIGTERM");
    }
    if (pendingLogin) clearTimeout(pendingLogin.timer);
    const clients = [
      ...this.#clients.values(),
      ...[...this.#confined.values()].map((confined) => confined.client),
      ...(pendingLogin ? [pendingLogin.client] : []),
    ];
    this.#clients.clear();
    this.#confined.clear();
    return clients;
  }

  markStopped(): void {
    this.#setStatus({ phase: "stopped", message: null });
  }

  async #runProviderConnectionCommand<T>(provider: AgentProvider, command: () => Promise<T>): Promise<T> {
    const previous = this.#providerConnectionCommands.get(provider) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => command());
    // What the queue holds is the turn, not its answer: a later command only waits for this one to
    // be over, and swallowing the failure here is what keeps a refused sign-in from surfacing a
    // second time as an unhandled rejection nobody is left awaiting.
    const current = run.then(
      () => undefined,
      () => undefined,
    );
    this.#providerConnectionCommands.set(provider, current);
    recordRestartActivity();
    try {
      return await run;
    } finally {
      if (this.#providerConnectionCommands.get(provider) === current) {
        this.#providerConnectionCommands.delete(provider);
      }
    }
  }

  async #refreshProviders(): Promise<AgentStatus> {
    await Promise.all(
      BUILT_IN_PROVIDER_DRIVERS.map((driver) =>
        this.#runProviderConnectionCommand(driver.id, async () => {
          switch (driver.signIn.kind) {
            case "browser":
              return this.#settleCodexLoginForRefresh();
            case "cli-command":
            case "external":
              // `external` has nothing to cancel, and the call is a no-op without a pending login.
              await this.#cancelCliLogin(driver.id, null);
              return this.status();
          }
        }),
      ),
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

    await Promise.all(
      activeClients.map(async ([provider, client]) => {
        try {
          const account = await client.request("account/read", { refreshToken: true }, decodeAccountReadResult, 5_000);
          // A sign-in can finish while the read waits and put a new client in place. The activation
          // stopped this one and set the status, so this answer describes nothing the app still uses.
          if (this.#clients.get(provider) !== client) return;
          if (account.account) {
            requireProviderDriver(provider).validateAccount(account.account);
            this.#accounts.set(provider, account.account);
            this.#setStatus({
              providers: updateProviderStatus(this.#status.providers, provider, {
                state: "available",
                version: this.#cli.get(provider)?.version ?? null,
                message: null,
                email: account.account.email ?? null,
                checkError: null,
              }),
            });
            return;
          }
          this.#clients.delete(provider);
          this.#cli.delete(provider);
          this.#accounts.delete(provider);
          await client.stop().catch(() => undefined);
          this.#hooks.onClientStopped(client);
          await Promise.all(
            [...this.#confined]
              .filter(([, confined]) => confined.client.provider === provider)
              .map(([agentId, confined]) => this.#stopConfined(agentId, confined)),
          );
        } catch {
          if (this.#clients.get(provider) !== client) return;
          // Keep a working client when an explicit account refresh is temporarily unavailable.
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
      }),
    );

    await this.#connect(
      "starting",
      BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id),
      { preserveCheckErrors: true, refreshRuntimeInBackground: true },
    );
    return this.status();
  }

  async #settleCodexLoginForRefresh(): Promise<AgentStatus> {
    const pending = this.#codexLogin;
    if (!pending) {
      this.#clearProviderConnectionState("codex");
      return this.status();
    }
    this.#codexLogin = null;
    clearTimeout(pending.timer);
    try {
      const account = await pending.client.request("account/read", { refreshToken: true }, decodeAccountReadResult);
      if (account.account?.type === "chatgpt") {
        await this.#activateProviderClient("codex", pending.client, pending.cli, account.account);
        return this.status();
      }
    } catch {
      // Fall through to cancellation and a fresh provider probe.
    }
    await pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .catch(() => undefined);
    await pending.client.stop().catch(() => undefined);
    this.#clearProviderConnectionState("codex");
    return this.status();
  }

  /** A CLI exit with its last stderr line in the message, after the MCP values are out of it. */
  #withExitDetail(error: unknown): unknown {
    return error instanceof AgentProcessExitError ? error.withDetail(this.#redactMcp) : error;
  }

  async #createAuthenticatedProviderClient(
    provider: AgentProvider,
    cli: AgentCliInfo,
    confinement?: ProcessConfinement,
  ): Promise<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }> {
    const driver = requireProviderDriver(provider);
    const client = this.#clientFactory
      ? this.#clientFactory(provider, cli, confinement)
      : driver.createClient(cli, this.#requestTimeoutMs, this.#credentials, confinement);
    this.#bindClient(client);
    client.start();
    try {
      await client.request(
        "initialize",
        {
          clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
          capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
        },
        decodeRecordResponse,
      );
      client.notify("initialized");
      const account = await client.request("account/read", { refreshToken: true }, decodeAccountReadResult);
      if (!account.account) {
        throw new Error(
          this.#customProviderSignInMessage(provider) ??
            sourceText("error.provider.noAuthenticatedAccount", { provider: providerLabel(provider) }),
        );
      }
      driver.validateAccount(account.account);
      return { client, account: account.account };
    } catch (error) {
      await client.stop().catch(() => undefined);
      // The CLI's last stderr line can quote an MCP secret that `redactText` does not know, and this
      // message reaches the status, the IPC answer and the runtime download error.
      throw this.#withExitDetail(error);
    }
  }

  async #activateProviderClient(
    provider: AgentProvider,
    client: AgentClient,
    cli: AgentCliInfo,
    account: NonNullable<AccountReadResult["account"]>,
    options: { isCurrent?: () => boolean; notifyReady?: boolean } = {},
  ): Promise<void> {
    const { isCurrent, notifyReady = true } = options;
    const activation = this.#providerActivation
      .catch(() => undefined)
      .then(async () => {
        if (isCurrent && !isCurrent()) {
          await client.stop().catch(() => undefined);
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
        try {
          const freshCatalogs = await this.#refreshModelCatalog();
          if (isCurrent && !isCurrent()) {
            if (previousClient) this.#clients.set(provider, previousClient);
            else this.#clients.delete(provider);
            if (previousCli) this.#cli.set(provider, previousCli);
            else this.#cli.delete(provider);
            if (previousAccount) this.#accounts.set(provider, previousAccount);
            else this.#accounts.delete(provider);
            if (client !== previousClient) await client.stop().catch(() => undefined);
            return;
          }
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
            // Carried through, not recomputed: Computer Use belongs to the driver the main process
            // owns, and a provider connecting says nothing about it.
            capabilities: { ...this.#status.capabilities, chat: "ready", browser: "ready" },
            message: null,
          });
          // Only with a catalogue this client itself reported. Discovery that failed leaves the
          // models from before it, and those still describe the process that ran then, so they are
          // no proof that an endpoint removed since is gone from the process answering now.
          if (freshCatalogs.has(provider)) {
            this.#hooks.onProviderActivated(provider, this.#configRevisions.get(client) ?? 0);
          }
        } catch (error) {
          if (previousClient) this.#clients.set(provider, previousClient);
          else this.#clients.delete(provider);
          if (previousCli) this.#cli.set(provider, previousCli);
          else this.#cli.delete(provider);
          if (previousAccount) this.#accounts.set(provider, previousAccount);
          else this.#accounts.delete(provider);
          if (client !== previousClient) await client.stop().catch(() => undefined);
          throw error;
        }

        if (previousClient && previousClient !== client) {
          await previousClient.stop().catch(() => undefined);
          this.#hooks.onClientStopped(previousClient);
        }
        if (provider === "codex") void this.#refreshUsage(client).catch(() => undefined);
        if (notifyReady) await this.#hooks.onProvidersReady();
      });
    this.#providerActivation = activation.catch(() => undefined);
    await activation;
  }

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
  async #reloadProviderCli(provider: AgentProvider, cli: AgentCliInfo): Promise<void> {
    if (!this.#clients.has(provider)) {
      this.#clearProviderConnectionState(provider);
      this.#cli.delete(provider);
      // Connecting the replaced CLI is not a start either: the other providers are running through
      // it, and `onProvidersReady` would settle their live deliveries. See below.
      await this.#connect("starting", [provider], { preserveCheckErrors: true, notifyReady: false });
      const status = this.status().providers?.find((row) => row.id === provider);
      if (status?.version !== cli.version || !["available", "sign-in-required"].includes(status.state)) {
        throw new Error(status?.message ?? sourceText("error.provider.cliActivateFailed"));
      }
      return;
    }
    const candidate = await this.#createAuthenticatedProviderClient(provider, cli);
    // Not a start: `onProvidersReady` is restart recovery, and it settles every unresolved delivery,
    // including the live ones of the other providers - a turn still running would be recorded as
    // interrupted, which `markTerminal` then refuses to correct. `onProviderResumed` schedules the
    // deliveries this replacement held back instead.
    await this.#activateProviderClient(provider, candidate.client, cli, candidate.account, {
      notifyReady: false,
    });
  }

  /**
   * Connects a provider that OpenBot never spawns a login for. The user signed in with the
   * provider's own CLI in a terminal, so this only starts a fresh client and asks the provider
   * which account it now has. A provider with a free tier answers with an account either way.
   */
  async #reprobeProvider(provider: AgentProvider): Promise<AgentStatus> {
    if (this.#hooks.isProviderBusy(provider)) {
      throw new Error(sourceText("error.provider.cliBusyReconnect", { provider: providerLabel(provider) }));
    }
    let cli: AgentCliInfo | null = null;
    this.#setProviderConnectionState(provider, "connecting");
    this.#replacingCli.add(provider);
    recordRestartActivity();
    try {
      cli = await this.#resolveProviderCli(provider);
      const candidate = await this.#createAuthenticatedProviderClient(provider, cli);
      await this.#activateProviderClient(provider, candidate.client, cli, candidate.account, { notifyReady: false });
      this.#clearProviderConnectionState(provider);
      return this.status();
    } catch (error) {
      this.#setProviderConnectionFailure(provider, error, cli?.version);
      throw error;
    } finally {
      this.#replacingCli.delete(provider);
      this.#hooks.onProviderResumed(provider);
    }
  }

  async #startCliLogin(provider: AgentProvider, command: ProviderCliCommand): Promise<AgentStatus> {
    let cli: AgentCliInfo | null = null;
    this.#setProviderConnectionState(provider, "connecting");

    try {
      cli = await this.#resolveProviderCli(provider);
      const child = spawn(cli.executable, [...command.argv], {
        cwd: process.cwd(),
        env: { ...process.env, ...command.env(cli) },
        stdio: "ignore",
        shell: false,
        windowsHide: process.platform === "win32",
      });
      const pending: PendingCliLogin = { child, cli, task: null };
      this.#cliLogins.set(provider, pending);
      recordRestartActivity();
      pending.task = waitForSuccessfulProcess(child, command.timeoutMs)
        .then(() => this.#completeCliLogin(provider, pending))
        .catch((error) => this.#failCliLogin(provider, pending, error));
      return this.status();
    } catch (error) {
      this.#setProviderConnectionFailure(provider, error, cli?.version);
      throw error;
    }
  }

  async #completeCliLogin(provider: AgentProvider, pending: PendingCliLogin): Promise<void> {
    if (this.#cliLogins.get(provider) !== pending) return;
    try {
      const candidate = await this.#createAuthenticatedProviderClient(provider, pending.cli);
      if (this.#cliLogins.get(provider) !== pending) {
        await candidate.client.stop().catch(() => undefined);
        return;
      }
      await this.#activateProviderClient(provider, candidate.client, pending.cli, candidate.account, {
        isCurrent: () => this.#cliLogins.get(provider) === pending,
      });
      if (this.#cliLogins.get(provider) === pending) this.#cliLogins.delete(provider);
    } catch (error) {
      await this.#failCliLogin(provider, pending, error);
    }
  }

  async #failCliLogin(provider: AgentProvider, pending: PendingCliLogin, error: unknown): Promise<void> {
    if (this.#cliLogins.get(provider) !== pending) return;
    this.#cliLogins.delete(provider);
    if (pending.child.exitCode === null) pending.child.kill("SIGTERM");
    this.#setProviderConnectionFailure(provider, error, pending.cli.version);
  }

  async #cancelCliLogin(provider: AgentProvider, message: string | null): Promise<void> {
    const pending = this.#cliLogins.get(provider);
    if (!pending) return;
    this.#cliLogins.delete(provider);
    if (pending.child.exitCode === null) pending.child.kill("SIGTERM");
    await pending.task?.catch(() => undefined);
    if (message) this.#setProviderConnectionFailure(provider, new Error(message), pending.cli.version);
    else this.#clearProviderConnectionState(provider);
  }

  /**
   * Brings a Codex client up to the point where a sign-in can start, and hands it to `run`.
   *
   * Returns null when the client turned out to be signed in already: the account was activated and
   * there is no login to start. Both sign-in shapes share this because everything before the
   * `account/login/start` call - the CLI, the handshake, the account already on this computer - and
   * everything the failure path has to undo is the same for a browser hand-off and for a code.
   */
  async #withCodexLoginClient<T>(run: (client: AgentClient, cli: CodexCliInfo) => Promise<T>): Promise<T | null> {
    let client: AgentClient | null = null;
    let cli: CodexCliInfo | null = null;
    this.#setProviderConnectionState("codex", "connecting");

    try {
      cli = await resolveCodexCli({ bundledExecutable: this.#bundledExecutables.codex });
      client = this.#clientFactory
        ? this.#clientFactory("codex", cli)
        : new CodexAppServerClient(cli.executable, this.#requestTimeoutMs);
      this.#bindClient(client);
      client.start();
      await client.request(
        "initialize",
        {
          clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
          capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
        },
        decodeRecordResponse,
      );
      client.notify("initialized");

      if (!this.#clients.has("codex")) {
        const existingAccount = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
        if (existingAccount.account?.type === "chatgpt") {
          await this.#activateProviderClient("codex", client, cli, existingAccount.account);
          return null;
        }
      }

      return await run(client, cli);
    } catch (error) {
      if (client && this.#codexLogin?.client !== client && this.#clients.get("codex") !== client) {
        await client.stop().catch(() => undefined);
      }
      const status = this.#status.providers?.find((provider) => provider.id === "codex");
      if (!this.#codexLogin && status?.connectionState === "connecting") {
        this.#setProviderConnectionFailure("codex", error, cli?.version);
      }
      throw error;
    }
  }

  /**
   * Holds a started login open until the provider reports it finished, or until it times out.
   *
   * The deadline is OpenBot's, not the provider's. The code flow counts down to the same moment on
   * screen, so the number the user reads is the one this timer acts on.
   */
  #trackCodexLogin(client: AgentClient, cli: CodexCliInfo, loginId: string): PendingCodexLogin {
    let pending: PendingCodexLogin;
    const timer = setTimeout(() => {
      void this.#cancelCodexLogin("ChatGPT connection timed out. Try again.", pending);
    }, CODEX_LOGIN_TIMEOUT_MS);
    timer.unref?.();
    pending = { client, cli, loginId, timer, completing: false };
    this.#codexLogin = pending;
    recordRestartActivity();
    client.once("exit", () => {
      if (this.#codexLogin?.client === client) {
        void this.#failCodexLogin(this.#codexLogin, "ChatGPT connection stopped. Try again.");
      }
    });
    return pending;
  }

  async #startCodexLogin(openExternal: (url: string) => Promise<void>): Promise<AgentStatus> {
    await this.#withCodexLoginClient(async (client, cli) => {
      const login = await client.request(
        "account/login/start",
        {
          type: "chatgpt",
          appBrand: "chatgpt",
          codexStreamlinedLogin: true,
          useHostedLoginSuccessPage: true,
        },
        decodeAccountLoginStartResult,
      );
      this.#trackCodexLogin(client, cli, login.loginId);
      try {
        await openExternal(login.authUrl);
      } catch {
        await this.#cancelCodexLogin("OpenBot could not open the ChatGPT connection page.");
        throw new Error(sourceText("error.provider.chatgptPageFailed"));
      }
    });
    return this.status();
  }

  /**
   * Starts the sign-in the user finishes on another device, and reports the code to show.
   *
   * Only the code and the page it is typed on cross back: the token the provider issues for that
   * code stays with the Codex client this method leaves running, exactly as it does for the browser
   * sign-in. How this one ends reaches the renderer the same way too, through the provider's status.
   */
  async #startCodexDeviceLogin(): Promise<ProviderCodeLoginStart> {
    const started = await this.#withCodexLoginClient(async (client, cli) => {
      const login = await client.request(
        "account/login/start",
        { type: "chatgptDeviceCode" },
        decodeAccountDeviceCodeLoginStartResult,
      );
      this.#trackCodexLogin(client, cli, login.loginId);
      return {
        kind: "code" as const,
        userCode: login.userCode,
        verificationUrl: login.verificationUrl,
        expiresAt: Date.now() + CODEX_LOGIN_TIMEOUT_MS,
      };
    });
    return started ?? { kind: "connected" };
  }

  async #completeCodexLogin(completion: AccountLoginCompletedResult, source: AgentClient): Promise<void> {
    const pending = this.#codexLogin;
    if (!pending || pending.completing) return;
    if (pending.client !== source) return;
    if (completion.loginId !== null && completion.loginId !== pending.loginId) return;
    pending.completing = true;
    clearTimeout(pending.timer);

    if (!completion.success) {
      await this.#failCodexLogin(pending, "ChatGPT connection was not completed. Try again.");
      return;
    }

    try {
      const account = await pending.client.request("account/read", { refreshToken: true }, decodeAccountReadResult);
      if (account.account?.type !== "chatgpt") {
        throw new Error(sourceText("error.provider.noAuthenticatedAccount", { provider: "ChatGPT" }));
      }
      if (this.#codexLogin !== pending) return;
      await this.#activateProviderClient("codex", pending.client, pending.cli, account.account, {
        isCurrent: () => this.#codexLogin === pending,
      });
      if (this.#codexLogin === pending) this.#codexLogin = null;
    } catch {
      await this.#failCodexLogin(pending, "OpenBot could not verify the ChatGPT connection. Try again.");
    }
  }

  async #cancelCodexLogin(message: string | null, expected?: PendingCodexLogin): Promise<void> {
    const pending = this.#codexLogin;
    if (!pending || (expected && pending !== expected)) return;
    this.#codexLogin = null;
    clearTimeout(pending.timer);
    await pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .catch(() => undefined);
    await pending.client.stop().catch(() => undefined);
    if (message) this.#setProviderConnectionFailure("codex", new Error(message), pending.cli.version);
    else this.#clearProviderConnectionState("codex");
  }

  async #failCodexLogin(pending: PendingCodexLogin, message: string): Promise<void> {
    if (this.#codexLogin !== pending) return;
    clearTimeout(pending.timer);
    this.#codexLogin = null;
    await pending.client.stop().catch(() => undefined);
    this.#setProviderConnectionFailure("codex", new Error(message), pending.cli.version);
  }

  async #connect(
    phase: "starting" | "restarting",
    requestedProviders: readonly AgentProvider[],
    options: { preserveCheckErrors?: boolean; refreshRuntimeInBackground?: boolean; notifyReady?: boolean } = {},
  ): Promise<void> {
    const disposals = this.#disposals;
    const disposed = () => this.#hooks.isStopping() || disposals !== this.#disposals;
    const hadClients = this.#clients.size > 0 || this.#released.size > 0;
    const providerStatuses: AgentProviderStatus[] = structuredClone(
      this.#status.providers ?? INITIAL_STATUS.providers ?? [],
    );
    for (const provider of requestedProviders) {
      const current = this.#status.providers?.find((candidate) => candidate.id === provider);
      setProviderStatus(providerStatuses, provider, {
        // A released provider is still connected: it only waits for a turn to start its process.
        state: this.#clients.has(provider) || this.#released.has(provider) ? "available" : "checking",
        version: this.#cli.get(provider)?.version ?? null,
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
    const results = await Promise.all(
      requestedProviders.map(async (provider): Promise<string | null> => {
        if (this.#clients.has(provider)) return null;
        const driver = requireProviderDriver(provider);
        let client: AgentClient | null = null;
        let cli: AgentCliInfo | null = null;
        try {
          cli = await this.#resolveProviderCli(provider);
          client = this.#clientFactory
            ? this.#clientFactory(provider, cli)
            : driver.createClient(cli, this.#requestTimeoutMs, this.#credentials);
          this.#bindClient(client);
          client.start();
          await client.request(
            "initialize",
            {
              clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
              capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
            },
            decodeRecordResponse,
          );
          client.notify("initialized");
          const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult, 5_000);
          if (!account.account) {
            const message =
              this.#customProviderSignInMessage(provider) ?? agentProviderDescriptor(provider).signInMessage;
            await client.stop().catch(() => undefined);
            this.#setStatus({
              providers: updateProviderStatus(this.#status.providers, provider, {
                state: "sign-in-required",
                version: cli.version,
                message,
                email: null,
              }),
            });
            return message;
          }
          driver.validateAccount(account.account);
          // `stop()` does not wait for a start: a client added after its `dispose()` would run on.
          if (disposed()) {
            await client.stop().catch(() => undefined);
            return null;
          }
          if (!this.#released.has(provider)) this.#countActivation(provider);
          this.#cli.set(provider, cli);
          this.#clients.set(provider, client);
          this.#accounts.set(provider, account.account);
          activated.push(provider);
          this.#setStatus({
            providers: updateProviderStatus(this.#status.providers, provider, {
              state: "available",
              version: cli.version,
              message: null,
              email: account.account.email ?? null,
            }),
          });
          return null;
        } catch (thrown) {
          if (client) await client.stop().catch(() => undefined);
          const error = this.#withExitDetail(thrown);
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
          if (!(error instanceof CodexCliError)) this.#emitError(`${provider}_start_failed`, error);
          return message;
        }
      }),
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
    if (!primaryProvider) throw new Error(sourceText("error.provider.noneReady"));
    const primaryAccount = this.#accounts.get(primaryProvider);
    for (const provider of activated) this.#restartAttempts.delete(provider);
    this.#setStatus({
      phase: "ready",
      cliVersion: this.#cli.get(primaryProvider)?.version ?? null,
      auth: requireProviderDriver(primaryProvider).authState(primaryAccount ?? null),
      providers: finalProviderStatuses,
      capabilities: { ...this.#status.capabilities, chat: "ready", browser: "ready" },
      message: null,
    });
    const refreshRuntime = async (): Promise<void> => {
      const codexClient = this.#clients.get("codex");
      const freshCatalogs = await this.#refreshModelCatalog();
      for (const provider of activated) {
        const client = this.#clients.get(provider);
        // The same condition as the other activation site: a stale catalogue proves nothing about
        // the endpoints the process now answering was given.
        if (client && freshCatalogs.has(provider)) {
          this.#hooks.onProviderActivated(provider, this.#configRevisions.get(client) ?? 0);
        }
      }
      // The catalogue is read off the status, so discovery that found new models has to publish one.
      // This used to ride along with a Computer Use probe that no longer exists.
      this.#setStatus({});
      if (codexClient) void this.#refreshUsage(codexClient).catch(() => undefined);
      if (options.notifyReady !== false) await this.#hooks.onProvidersReady();
    };
    if (options.refreshRuntimeInBackground) {
      void refreshRuntime().catch((error) => this.#emitError("provider_metadata_refresh_failed", error));
      return;
    }
    await refreshRuntime();
  }

  #bindClient(client: AgentClient): void {
    // Taken before `start()`, which is where the CLI reads the endpoint files.
    this.#configRevisions.set(client, this.#hooks.captureConfigRevision());
    this.#hooks.bindClient(client);
    client.on("diagnostic", (raw) => {
      if (!/error|failed|warning/i.test(raw)) return;
      const names = new Set([
        ...this.#credentials.mcpServers().map((config) => config.name),
        ...this.#mcpHandoff.names(),
      ]);
      // Redacted before the first use, not at each one. A CLI reports an MCP failure by quoting
      // what it sent, so an API key or an inherited credential is in the line that is about to be
      // logged or turned into a renderer error event. Shortened after that, because a value cut in
      // half is a value the redactor does not match.
      const message = shortenDiagnostic(this.#redactMcp(raw));
      if (isMcpSubsystemDiagnostic(message, [...names])) {
        logger.warn("A provider reported an MCP server failure.", { provider: client.provider, message });
        return;
      }
      if (isTelemetryExportDiagnostic(message)) {
        logger.warn("A provider reported a telemetry export failure.", { provider: client.provider, message });
        return;
      }
      if (isToolCallDiagnostic(message)) {
        logger.warn("A provider reported a failed tool call.", { provider: client.provider, message });
        return;
      }
      if (isBackgroundRefreshDiagnostic(message)) {
        logger.warn("A provider reported a failed background refresh.", { provider: client.provider, message });
        return;
      }
      if (isUsageLimitDiagnostic(message)) {
        logger.warn("A provider reported an exhausted usage limit.", { provider: client.provider, message });
        this.refreshUsageAfterLimit(client);
        return;
      }
      // Without the timestamp, a repeat of one failure is the same message, and the renderer shows
      // it once rather than once per attempt.
      this.#emitError(`${client.provider}_diagnostic`, message.replace(LOG_TIMESTAMP_PREFIX, ""));
    });
    client.once("exit", (error) => this.#handleExit(client, error));
  }

  #handleExit(client: AgentClient, error: Error): void {
    if (this.#handleConfinedExit(client, error)) return;
    if (this.#clients.get(client.provider) !== client || this.#hooks.isStopping()) return;
    this.#clients.delete(client.provider);
    void client.stop().catch(() => undefined);
    this.#conversation.clearLoadedThreads();
    this.#hooks.onProviderLost(client);
    this.#emitError(`${client.provider}_exited`, error);
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
    const provider = client.provider;
    clearTimeout(this.#restartTimers.get(provider));
    this.#restartTimers.set(
      provider,
      setTimeout(() => {
        this.#restartTimers.delete(provider);
        void this.#restart(provider);
      }, delayMs),
    );
  }

  async #restart(provider: AgentProvider): Promise<void> {
    const disposals = this.#disposals;
    // A turn in the backoff may have started the provider already: a second connect would replace
    // that client and leave it running. That start can also end with no client, when the client it
    // added exits before the start ends, so the retry waits for it rather than being dropped.
    for (let pending = this.#providerStarts.get(provider); pending; pending = this.#providerStarts.get(provider)) {
      await pending.catch(() => undefined);
    }
    if (this.#hooks.isStopping() || disposals !== this.#disposals || this.#clients.has(provider)) return;
    const start = this.#connect("restarting", [provider])
      .catch((error) => this.#emitError(`${provider}_restart_failed`, error))
      .finally(() => {
        this.#providerStarts.delete(provider);
      });
    this.#providerStarts.set(provider, start);
    recordRestartActivity();
  }

  /**
   * Reads the catalogue of every connected CLI, and answers which providers replied with a fresh one.
   *
   * A provider that has no client, or whose `model/list` failed or timed out, keeps the models it
   * already had. That is the right catalogue to keep answering with, but it is not proof of what the
   * process now running serves, so its id is absent from the set and no caller may treat it as proof.
   */
  async #refreshModelCatalog(): Promise<Set<AgentProvider>> {
    const discovered = await Promise.all(
      BUILT_IN_PROVIDER_DRIVERS.map(
        async ({ id: provider }): Promise<{ provider: AgentProvider; models: AgentModelOption[]; fresh: boolean }> => {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#clients.get(provider);
          if (!client) return { provider, models: previous, fresh: false };
          // Read once per pass, not per model: a stored key cannot change inside one refresh, and
          // a model is unusable only because OpenBot is what put that key in the environment.
          const hasStoredKey = Boolean(this.#credentials.apiKey(provider));
          try {
            const serverModels = new Map<string, ModelListResponse["data"][number]>();
            const cursors = new Set<string>();
            let cursor: string | undefined;
            do {
              const response = await client.request(
                "model/list",
                { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
                decodeModelListResponse,
                5_000,
              );
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
                serverModels.set(id, { ...item, model: id });
              }
              cursor = client.provider === "codex" ? response.nextCursor : undefined;
              if (cursor && cursors.has(cursor)) throw new Error("Model discovery repeated a pagination cursor.");
              if (cursor) cursors.add(cursor);
            } while (cursor);
            const models: AgentModelOption[] = [];
            for (const server of serverModels.values()) {
              if (!server.model) continue;
              const fallback = FALLBACK_MODELS.find(
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
            return { provider, models: sorted, fresh: true };
          } catch {
            return { provider, models: previous, fresh: false };
          }
        },
      ),
    );
    this.#models = discovered.flatMap((entry) => entry.models);
    return new Set(discovered.filter((entry) => entry.fresh).map((entry) => entry.provider));
  }

  async #refreshUsage(client: AgentClient, model?: string, emit = true): Promise<AccountUsage> {
    const rateLimits = await client.request(
      "account/rateLimits/read",
      client.provider === "codex" ? undefined : { model },
      decodeAccountRateLimitsReadResult,
    );
    const usage = normalizeAccountUsage(rateLimits, client.provider === "codex" ? model : undefined);
    if (emit) this.#emit({ type: "usage-changed", usage: structuredClone(usage) });
    return structuredClone(usage);
  }

  #setStatus(patch: Partial<AgentStatus>): void {
    this.#status = {
      ...this.#status,
      ...patch,
      capabilities: patch.capabilities ?? this.#status.capabilities,
    };
    this.#emit({ type: "status", status: this.status() });
  }
}
