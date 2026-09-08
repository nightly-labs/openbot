import { type ChildProcess, spawn } from "node:child_process";
import type {
  AccountUsage,
  AgentEvent,
  AgentModelOption,
  AgentProviderStatus,
  AgentStatus,
  AgentSummary,
} from "@openbot/contracts/ipc";
import { isReasoningEffort } from "@openbot/contracts/ipc";
import type { AgentClient, AgentProvider } from "./../agent-client";
import { CodexAppServerClient } from "./../app-server-client";
import { type AgentCliInfo, CodexCliError, type CodexCliInfo, resolveCodexCli } from "./../cli";
import { GrokAgentClient } from "../grok-client";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  decodeAccountLoginStartResult,
  decodeAccountRateLimitsReadResult,
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  getArray,
  isRecord,
  type ModelListResponse,
} from "./../protocol";
import { BUILT_IN_PROVIDER_DRIVERS, type ProviderCliCommand, requireProviderDriver } from "./../provider-drivers";
import { normalizeAccountUsage } from "./account-usage";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  providerFailureStatus,
  readProcessReason,
  setProviderStatus,
  updateProviderStatus,
  waitForSuccessfulProcess,
} from "./provider-status";
import { providerForAgent, providerLabel } from "./thread-items";

const CODEX_LOGIN_TIMEOUT_MS = 10 * 60_000;

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

export type AgentClientFactory = (provider: AgentProvider, cli: AgentCliInfo) => AgentClient;

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
  /** True once stop() has begun, so a client exiting during shutdown does not trigger a restart. */
  isStopping(): boolean;
  /** True while a turn on this provider runs or starts, which replacing its CLI would cut short. */
  isProviderBusy(provider: AgentProvider): boolean;
  /** Runs after a CLI replacement, so deliveries held back during it are delivered. */
  onProviderResumed(provider: AgentProvider): void;
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
 * Models a provider CLI lists that an OpenBot agent is not meant to run. `codex-auto-review` and
 * `gpt-reserve` are Codex picks for its own use -- a review pass and spare capacity -- and
 * `gpt-5.5` and `gpt-5.4-mini` are older models this product does not offer. Everything else the
 * CLI reports reaches the picker, the models it marks hidden included, so this list is the only
 * thing that keeps a model out and adding to it is a product decision, not a guess about a flag.
 */
const SUPPRESSED_MODEL_IDS: ReadonlyMap<AgentProvider, ReadonlySet<string>> = new Map([
  ["codex", new Set(["gpt-reserve", "gpt-5.5", "gpt-5.4-mini", "codex-auto-review"])],
]);

/**
 * The product name of a Claude model, from its id, or `null` for an id that does not read as one.
 *
 * Claude Code lists a model by the part it plays in that CLI - "Default (recommended)", "Opus" -
 * so its display name says which pick it is there, not which model an agent runs here. The picker
 * puts all three providers side by side, and the other two name a model in full, so the same
 * sentence has to be true of this one: the id carries it, with a release stamp the picker has no
 * use for. `claude-haiku-4-5-20251001` is Claude Haiku 4.5, and `claude-fable-5-1[1m]` is the 1M
 * context window of Claude Fable 5.1.
 */
function claudeModelName(id: string): string | null {
  const parsed = /^([a-z0-9-]+?)(?:\[([a-z0-9]+)\])?$/u.exec(id.trim().toLowerCase());
  if (!parsed) return null;
  const [, base = "", variant] = parsed;
  const parts = base.split("-");
  if (parts.shift() !== "claude") return null;
  const family = parts.shift();
  if (!family || !/^[a-z]+$/u.test(family)) return null;
  // Eight digits are the build date, which names a release of the model rather than the model.
  const version = parts.filter((part) => !/^\d{8}$/u.test(part));
  if (!version.length || version.some((part) => !/^\d+$/u.test(part))) return null;
  const name = `Claude ${family[0]?.toUpperCase()}${family.slice(1)} ${version.join(".")}`;
  return variant ? `${name} (${variant.toUpperCase()} context)` : name;
}

const FALLBACK_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced speed and capability for involved tasks.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-fable-5",
    name: "Claude Fable 5",
    description: "Fast Claude model for everyday agent work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    description: "Most capable Claude model for complex work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Balanced Claude model for general agent work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
];

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
  readonly #bundledExecutables: ReadonlyMap<AgentProvider, string | null | undefined>;
  readonly #clients = new Map<AgentProvider, AgentClient>();
  readonly #cli = new Map<AgentProvider, AgentCliInfo>();
  readonly #accounts = new Map<AgentProvider, AccountReadResult["account"]>();
  readonly #providerStarts = new Map<AgentProvider, Promise<void>>();
  readonly #providerConnectionCommands = new Map<AgentProvider, Promise<void>>();
  readonly #replacingCli = new Set<AgentProvider>();
  #status: AgentStatus = structuredClone(INITIAL_STATUS);
  #providerRefresh: Promise<AgentStatus> | null = null;
  #codexLogin: PendingCodexLogin | null = null;
  readonly #cliLogins = new Map<AgentProvider, PendingCliLogin>();
  #providerActivation = Promise.resolve();
  #preferredProvider: AgentProvider;
  #restartAttempts = 0;
  #restartTimer: NodeJS.Timeout | null = null;
  #models = structuredClone(FALLBACK_MODELS);

  constructor(options: {
    conversation: ConversationRuntime;
    hooks: ProviderHooks;
    emit: (event: AgentEvent) => void;
    emitError: (code: string, error: unknown, agentId?: string) => void;
    requestTimeoutMs: number;
    preferredProvider: AgentProvider;
    clientFactory: AgentClientFactory | null;
    bundledCodexExecutable: string | null | undefined;
    bundledClaudeExecutable: string | null | undefined;
    bundledGrokExecutable: string | null | undefined;
  }) {
    this.#conversation = options.conversation;
    this.#hooks = options.hooks;
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#preferredProvider = options.preferredProvider;
    this.#clientFactory = options.clientFactory;
    this.#bundledExecutables = new Map([
      ["codex", options.bundledCodexExecutable],
      ["claude", options.bundledClaudeExecutable],
      ["grok", options.bundledGrokExecutable],
    ]);
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
        const source = this.#cli.get(row.id)?.source;
        return source ? { ...row, cliSource: source } : row;
      }),
    };
  }

  isReady(): boolean {
    return this.#status.phase === "ready";
  }

  clientFor(provider: AgentProvider): AgentClient | null {
    return this.#clients.get(provider) ?? null;
  }

  listModels(): AgentModelOption[] {
    return structuredClone(this.#models);
  }

  createProfileClient(provider: AgentProvider): AgentClient {
    const cli = this.#cli.get(provider);
    if (!cli || !this.#clients.has(provider))
      throw new Error("Connect the selected provider before generating a profile.");
    if (this.#clientFactory) return this.#clientFactory(provider, cli);
    if (provider === "grok") return new GrokAgentClient(cli, this.#requestTimeoutMs, true);
    return requireProviderDriver(provider).createClient(cli, this.#requestTimeoutMs);
  }

  preferredProvider(): AgentProvider {
    return this.#preferredProvider;
  }

  /**
   * Without a scope this is the account-wide reading the dock polls, and it broadcasts.
   * Scoped to one agent it answers for that agent's own model and stays quiet: the reply goes to
   * the caller that asked, so it must not overwrite the account-wide figure every other view shows.
   */
  async usage(scope?: { provider: AgentProvider; model: string }): Promise<AccountUsage> {
    if (!scope) {
      const client = this.#clients.get("codex");
      return client ? this.#refreshUsage(client) : { limits: [] };
    }
    const client = this.#clients.get(scope.provider);
    return client ? this.#refreshUsage(client, scope.model, false) : { limits: [] };
  }

  async start(): Promise<void> {
    await this.#connect(
      "starting",
      BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id),
    );
  }

  async setPreferredProvider(provider: AgentProvider, initialized: boolean): Promise<void> {
    this.#preferredProvider = provider;
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
    if (this.#clients.has(provider)) return;
    let start = this.#providerStarts.get(provider);
    if (!start) {
      start = this.#connect("starting", [provider]).finally(() => {
        this.#providerStarts.delete(provider);
      });
      this.#providerStarts.set(provider, start);
    }
    await start;
    if (this.#clients.has(provider)) return;
    const status = this.#status.providers?.find((candidate) => candidate.id === provider);
    throw new Error(status?.message ?? `${providerLabel(provider)} CLI is not ready or signed in.`);
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
    }
    await start;
    return this.status();
  }

  /**
   * Signs the user in to one provider. `openExternal` is only reached by Codex, whose login
   * hands back a URL; the other two open their own browser window from the CLI they spawn.
   */
  async connectProvider(provider: AgentProvider, openExternal: (url: string) => Promise<void>): Promise<AgentStatus> {
    const start = this.#providerStarts.get(provider);
    if (start) await start;
    if (start && this.#clients.has(provider) && this.#accounts.has(provider)) return this.status();
    if (this.#providerRefresh || (!start && ["starting", "restarting"].includes(this.#status.phase))) {
      return Promise.resolve(this.status());
    }
    const cliLogin = requireProviderDriver(provider).cliLogin;
    return this.#runProviderConnectionCommand(provider, async () => {
      if (!cliLogin) {
        await this.#cancelCodexLogin(null);
        return this.#startCodexLogin(openExternal);
      }
      await this.#cancelCliLogin(provider, null);
      return this.#startCliLogin(provider, cliLogin);
    });
  }

  /**
   * Runs the provider CLI's own updater. This is for an install the user made: it answers to them,
   * and this is how they move it to a version newer than the one OpenBot pins, without waiting for
   * an OpenBot release. The managed copy is refused, because the runtime manager replaces that one
   * whole and a self-updater inside it would leave two owners for one directory.
   */
  async updateProviderCli(provider: AgentProvider): Promise<AgentStatus> {
    const driver = requireProviderDriver(provider);
    const command = driver.cliUpdate;
    if (!command) throw new Error(`OpenBot cannot update the ${providerLabel(provider)} CLI.`);
    return this.#runProviderConnectionCommand(provider, async () => {
      const cli = await driver.resolveCli({ bundledExecutable: this.#bundledExecutables.get(provider) });
      if (cli.source === "managed") {
        throw new Error(`OpenBot manages this ${providerLabel(provider)} CLI and updates it with the app.`);
      }
      // The update replaces the binary under a running client, and the client is restarted after
      // it. A turn in flight would lose its process, so the user is asked to wait instead.
      if (this.#hooks.isProviderBusy(provider)) {
        throw new Error(`The ${providerLabel(provider)} CLI is working on a turn. Wait for it to finish, then update.`);
      }
      this.#setProviderConnectionState(provider, "connecting");
      // No turn may start on this provider until the new client is ready. Deliveries wait in the
      // mailbox and #activateProviderClient schedules them again.
      this.#replacingCli.add(provider);
      try {
        let reason: () => string | null = () => null;
        try {
          const child = spawn(cli.executable, [...command.argv], {
            cwd: process.cwd(),
            env: { ...process.env, ...command.env(cli) },
            // Only the error stream is read. An updater that refuses - a CLI installed by a package
            // manager that wants to own the upgrade, most often - says why there, and its own reason
            // is worth more to the user than an exit code.
            stdio: ["ignore", "ignore", "pipe"],
            shell: false,
            windowsHide: process.platform === "win32",
          });
          reason = readProcessReason(child);
          await waitForSuccessfulProcess(child, command.timeoutMs, "Provider update");
        } catch (error) {
          // One error for both readers: the row and the caller each get the updater's own reason.
          const failure = new Error(
            `OpenBot could not update the ${providerLabel(provider)} CLI. ${reason() ?? "Try again."}`,
            { cause: error },
          );
          this.#setProviderConnectionFailure(provider, failure, cli.version);
          throw failure;
        }
        // The running client still executes the binary the updater replaced, so it is restarted
        // here. Its version is what the row shows, and the new one is the point of the command.
        try {
          await this.#reloadProviderCli(provider);
        } catch (error) {
          this.#setProviderConnectionFailure(provider, error, cli.version);
          throw error;
        }
      } finally {
        this.#replacingCli.delete(provider);
        // Also after a failure: nothing else schedules the deliveries this update held back.
        this.#hooks.onProviderResumed(provider);
      }
      return this.status();
    });
  }

  clientForAgent(agent: AgentSummary): AgentClient | null {
    return this.#clients.get(providerForAgent(agent)) ?? null;
  }

  /** True while the CLI's own updater runs and the client that used the old binary is replaced. */
  isReplacingCli(provider: AgentProvider): boolean {
    return this.#replacingCli.has(provider);
  }

  requireReadyClient(provider: AgentProvider): AgentClient {
    const client = this.#clients.get(provider);
    if (!client || this.#status.phase !== "ready") {
      throw new Error(this.#status.message ?? `${providerLabel(provider)} CLI is not ready or signed in.`);
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

  /** Router arm: the bundled computer-use MCP server changed state. */
  setComputerUseCapability(computerUse: "ready" | "setup-required"): void {
    this.#setStatus({ capabilities: { ...this.#status.capabilities, computerUse } });
  }

  /** Router arm: the CLI pushed new rate limits. */
  refreshCodexUsage(): void {
    const client = this.#clients.get("codex");
    if (client) void this.#refreshUsage(client).catch(() => undefined);
  }

  /**
   * The provider half of stop(). Returns the clients the caller still has to await, because
   * stop() interleaves that wait with the mailbox and image-generation teardown.
   */
  dispose(): AgentClient[] {
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    const pendingLogin = this.#codexLogin;
    this.#codexLogin = null;
    const cliLogins = [...this.#cliLogins.values()];
    this.#cliLogins.clear();
    this.#providerConnectionCommands.clear();
    for (const login of cliLogins) {
      if (login.child.exitCode === null) login.child.kill("SIGTERM");
    }
    if (pendingLogin) clearTimeout(pendingLogin.timer);
    const clients = [...this.#clients.values(), ...(pendingLogin ? [pendingLogin.client] : [])];
    this.#clients.clear();
    return clients;
  }

  markStopped(): void {
    this.#setStatus({ phase: "stopped", message: null });
  }

  async #runProviderConnectionCommand(
    provider: AgentProvider,
    command: () => Promise<AgentStatus>,
  ): Promise<AgentStatus> {
    const previous = this.#providerConnectionCommands.get(provider) ?? Promise.resolve();
    let result = this.status();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        result = await command();
      });
    this.#providerConnectionCommands.set(provider, current);
    try {
      await current;
      return result;
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
          if (!driver.cliLogin) return this.#settleCodexLoginForRefresh();
          await this.#cancelCliLogin(driver.id, null);
          return this.status();
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
        } catch {
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

  async #createAuthenticatedProviderClient(
    provider: AgentProvider,
    cli: AgentCliInfo,
  ): Promise<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }> {
    const driver = requireProviderDriver(provider);
    const client = this.#clientFactory
      ? this.#clientFactory(provider, cli)
      : driver.createClient(cli, this.#requestTimeoutMs);
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
      if (!account.account) throw new Error(`${providerLabel(provider)} did not return an authenticated account.`);
      driver.validateAccount(account.account);
      return { client, account: account.account };
    } catch (error) {
      await client.stop().catch(() => undefined);
      throw error;
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
        this.#clients.set(provider, client);
        this.#cli.set(provider, cli);
        this.#accounts.set(provider, account);
        try {
          await this.#refreshModelCatalog();
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
          const codexClient = this.#clients.get("codex");
          const computerUse = codexClient ? await this.#probeComputerUse(codexClient) : "unavailable";
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
            capabilities: { chat: "ready", browser: "ready", computerUse },
            message: null,
          });
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

        if (previousClient && previousClient !== client) await previousClient.stop().catch(() => undefined);
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

  #setProviderConnectionFailure(provider: AgentProvider, error: unknown, version?: string | null): void {
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
      : error instanceof CodexCliError
        ? providerFailureStatus(provider, error, version)
        : {
            state: "sign-in-required" as const,
            version: version ?? null,
            message,
            email: null,
          };
    const hasProvider = this.#clients.size > 0;
    this.#setStatus({
      phase: hasProvider ? "ready" : "blocked",
      providers: updateProviderStatus(this.#status.providers, provider, status),
      capabilities: { ...this.#status.capabilities, chat: hasProvider ? "ready" : "unavailable" },
      message: hasProvider ? null : message,
    });
  }

  /** Puts a provider back on the binary that is on disk now, after its CLI replaced itself. */
  async #reloadProviderCli(provider: AgentProvider): Promise<void> {
    if (!this.#clients.has(provider)) {
      this.#clearProviderConnectionState(provider);
      this.#cli.delete(provider);
      // Connecting the replaced CLI is not a start either: the other providers are running through
      // it, and `onProvidersReady` would settle their live deliveries. See below.
      await this.#connect("starting", [provider], { preserveCheckErrors: true, notifyReady: false });
      return;
    }
    const cli = await requireProviderDriver(provider).resolveCli({
      bundledExecutable: this.#bundledExecutables.get(provider),
    });
    const candidate = await this.#createAuthenticatedProviderClient(provider, cli);
    // Not a start: `onProvidersReady` is restart recovery, and it settles every unresolved delivery,
    // including the live ones of the other providers - a turn still running would be recorded as
    // interrupted, which `markTerminal` then refuses to correct. `onProviderResumed` schedules the
    // deliveries this replacement held back instead.
    await this.#activateProviderClient(provider, candidate.client, cli, candidate.account, {
      notifyReady: false,
    });
  }

  async #startCliLogin(provider: AgentProvider, command: ProviderCliCommand): Promise<AgentStatus> {
    let cli: AgentCliInfo | null = null;
    this.#setProviderConnectionState(provider, "connecting");

    try {
      cli = await requireProviderDriver(provider).resolveCli({
        bundledExecutable: this.#bundledExecutables.get(provider),
      });
      const child = spawn(cli.executable, [...command.argv], {
        cwd: process.cwd(),
        env: { ...process.env, ...command.env(cli) },
        stdio: "ignore",
        shell: false,
        windowsHide: process.platform === "win32",
      });
      const pending: PendingCliLogin = { child, cli, task: null };
      this.#cliLogins.set(provider, pending);
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

  async #startCodexLogin(openExternal: (url: string) => Promise<void>): Promise<AgentStatus> {
    let client: AgentClient | null = null;
    let cli: CodexCliInfo | null = null;
    this.#setProviderConnectionState("codex", "connecting");

    try {
      cli = await resolveCodexCli({ bundledExecutable: this.#bundledExecutables.get("codex") });
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
          return this.status();
        }
      }

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
      let pending: PendingCodexLogin;
      const timer = setTimeout(() => {
        void this.#cancelCodexLogin("ChatGPT connection timed out. Try again.", pending);
      }, CODEX_LOGIN_TIMEOUT_MS);
      timer.unref?.();
      pending = { client, cli, loginId: login.loginId, timer, completing: false };
      this.#codexLogin = pending;
      client.once("exit", () => {
        if (this.#codexLogin?.client === client) {
          void this.#failCodexLogin(this.#codexLogin, "ChatGPT connection stopped. Try again.");
        }
      });
      try {
        await openExternal(login.authUrl);
      } catch {
        await this.#cancelCodexLogin("OpenBot could not open the ChatGPT connection page.");
        throw new Error("OpenBot could not open the ChatGPT connection page.");
      }
      return this.status();
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
        throw new Error("ChatGPT did not return an authenticated account.");
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
    const hadClients = this.#clients.size > 0;
    const providerStatuses: AgentProviderStatus[] = structuredClone(
      this.#status.providers ?? INITIAL_STATUS.providers ?? [],
    );
    for (const provider of requestedProviders) {
      const current = this.#status.providers?.find((candidate) => candidate.id === provider);
      setProviderStatus(providerStatuses, provider, {
        state: this.#clients.has(provider) ? "available" : "checking",
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

    const results = await Promise.all(
      requestedProviders.map(async (provider): Promise<string | null> => {
        if (this.#clients.has(provider)) return null;
        const driver = requireProviderDriver(provider);
        let client: AgentClient | null = null;
        let cli: AgentCliInfo | null = null;
        try {
          cli = await driver.resolveCli({ bundledExecutable: this.#bundledExecutables.get(provider) });
          client = this.#clientFactory
            ? this.#clientFactory(provider, cli)
            : driver.createClient(cli, this.#requestTimeoutMs);
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
            const message = provider === "codex" ? "Connect ChatGPT to continue." : driver.signInMessage;
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
          this.#cli.set(provider, cli);
          this.#clients.set(provider, client);
          this.#accounts.set(provider, account.account);
          this.#setStatus({
            providers: updateProviderStatus(this.#status.providers, provider, {
              state: "available",
              version: cli.version,
              message: null,
              email: account.account.email ?? null,
            }),
          });
          return null;
        } catch (error) {
          if (client) await client.stop().catch(() => undefined);
          const message = error instanceof Error ? error.message : String(error);
          this.#setStatus({
            providers: updateProviderStatus(
              this.#status.providers,
              provider,
              providerFailureStatus(provider, error, cli?.version),
            ),
          });
          if (!(error instanceof CodexCliError)) this.#emitError(`${provider}_start_failed`, error);
          return message;
        }
      }),
    );
    const failures = results.filter((message): message is string => message !== null);
    const finalProviderStatuses = structuredClone(this.#status.providers ?? providerStatuses);

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
    if (!primaryProvider) throw new Error("No agent provider is ready.");
    const primaryAccount = this.#accounts.get(primaryProvider);
    this.#restartAttempts = 0;
    this.#setStatus({
      phase: "ready",
      cliVersion: this.#cli.get(primaryProvider)?.version ?? null,
      auth: requireProviderDriver(primaryProvider).authState(primaryAccount ?? null),
      providers: finalProviderStatuses,
      capabilities: {
        chat: "ready",
        browser: "ready",
        computerUse: this.#clients.has("codex") ? this.#status.capabilities.computerUse : "unavailable",
      },
      message: null,
    });
    const refreshRuntime = async (): Promise<void> => {
      const codexClient = this.#clients.get("codex");
      const [, computerUse] = await Promise.all([
        this.#refreshModelCatalog(),
        codexClient ? this.#probeComputerUse(codexClient) : Promise.resolve("unavailable" as const),
      ]);
      if (codexClient === this.#clients.get("codex")) {
        this.#setStatus({
          capabilities: { ...this.#status.capabilities, computerUse },
        });
      }
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
    this.#hooks.bindClient(client);
    client.on("diagnostic", (message) => {
      if (/error|failed|warning/i.test(message)) {
        this.#emitError(`${client.provider}_diagnostic`, message);
      }
    });
    client.once("exit", (error) => this.#handleExit(client, error));
  }

  #handleExit(client: AgentClient, error: Error): void {
    if (this.#clients.get(client.provider) !== client || this.#hooks.isStopping()) return;
    this.#clients.delete(client.provider);
    void client.stop().catch(() => undefined);
    this.#conversation.clearLoadedThreads();
    this.#hooks.onProviderLost(client);
    this.#emitError(`${client.provider}_exited`, error);
    const providers = updateProviderStatus(this.#status.providers, client.provider, {
      state: "error",
      version: this.#cli.get(client.provider)?.version ?? null,
      message: error.message,
    });
    const anotherProviderIsReady = this.#clients.size > 0;

    if (this.#restartAttempts >= 3) {
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

    const delayMs = 500 * 2 ** this.#restartAttempts;
    this.#restartAttempts += 1;
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
            message: `${providerLabel(client.provider)} stopped. Retrying (${this.#restartAttempts}/3)…`,
          },
    );
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      void this.#connect("restarting", [client.provider]);
    }, delayMs);
  }

  async #refreshModelCatalog(): Promise<void> {
    const discovered = (
      await Promise.all(
        BUILT_IN_PROVIDER_DRIVERS.map(async ({ id: provider }): Promise<AgentModelOption[]> => {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#clients.get(provider);
          if (!client) return previous;
          const suppressed = SUPPRESSED_MODEL_IDS.get(provider) ?? new Set<string>();
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
              // Every model the CLI reports is offered apart from SUPPRESSED_MODEL_IDS, the ones it
              // marks hidden included. A CLI hides a model it still accepts -- a new release such
              // as `gpt-6-astra` is hidden until its own launch -- and this app has no way to tell
              // that apart from a model the account cannot use, so a hidden flag was the only
              // reason a working model was missing from the picker while the same CLI ran it
              // happily from a terminal.
              for (const item of response.data) {
                // The trimmed id is what is kept: `isAgentModel` allows no whitespace, so a padded
                // id would fail the contract guard downstream and take the whole list with it.
                const id = item.model?.trim();
                if (!id || suppressed.has(id.toLowerCase())) continue;
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
              models.push({
                provider: client.provider,
                id: server.model,
                // The name the provider CLI gives, whole: a model is easier to recognise as
                // `GPT-5.6 Sol` than as `Sol`, and its own CLI names it that way.
                // Claude Code is the exception, and `claudeModelName` says why.
                name:
                  (client.provider === "claude" ? claudeModelName(server.model) : null) ||
                  server.displayName?.trim() ||
                  fallback?.name ||
                  server.model,
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
            return models;
          } catch {
            return previous;
          }
        }),
      )
    ).flat();
    this.#models = discovered;
  }

  async #probeComputerUse(client: AgentClient): Promise<"ready" | "setup-required" | "unavailable"> {
    try {
      const result = await client.request("plugin/list", { cwds: [] }, decodeRecordResponse, 5_000);
      for (const marketplace of getArray(result, "marketplaces")) {
        for (const plugin of getArray(marketplace, "plugins")) {
          if (!isRecord(plugin)) continue;
          if (
            (plugin.id === "computer-use@openai-bundled" || plugin.name === "computer-use") &&
            plugin.installed === true &&
            plugin.enabled === true
          ) {
            return "ready";
          }
        }
      }
      return "unavailable";
    } catch {
      return "unavailable";
    }
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
