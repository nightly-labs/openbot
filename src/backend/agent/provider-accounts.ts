import { spawn } from "node:child_process";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  type AccountUsage,
  type AccountUsageLimit,
  agentProviderDescriptor,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  MAX_PROVIDER_ACCOUNTS,
  type ProviderAccountState,
  type ProviderAccountStatus,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  usageQuotaForModel,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Effect, Fiber, Schema, type Scope } from "effect";
import { startAcpAuthentication } from "./../acp-sign-in";
import type { AgentClient } from "./../agent-client";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "./../cli";
import type { AccountReadResult } from "./../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import { type ProviderAccountSupport, requireProviderDriver } from "./../provider-drivers";
import type { ProviderTempOptions } from "./../provider-temp";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { stopProcessTree } from "../windows-process-tree";
import { usageWindowResetSince } from "./account-usage";
import { captureBrowser } from "./browser-capture";
import type { ProviderAccountStore, StoredProviderAccount } from "./provider-account-store";
import { type ProviderProcessFailed, waitForSuccessfulProcess } from "./provider-status";
import { providerLabel } from "./thread-items";
import { UsageReadGate } from "./usage-read-gate";

const logger = createOpenBotLogger("provider-accounts");

/** How long an account check stays good. `UsageReadGate` paces the usage readings. */
const ACCOUNT_CHECK_TTL_MS = 5 * 60_000;

export class ProviderAccountFailed extends Schema.TaggedError<ProviderAccountFailed>()("ProviderAccountFailed", {
  cause: Schema.Defect(),
}) {}

function accountFailure(text: string): ProviderAccountFailed {
  return new ProviderAccountFailed({ cause: new Error(text) });
}

interface AccountState {
  state: ProviderAccountState;
  email: string | null;
  message: string | null;
  checkedAt: number;
}

/** What the accounts need from the provider runtime. */
export interface ProviderAccountsHost {
  scope(): Scope.Scope;
  /** The CLI of the provider's own sign-in, or undefined when it is not connected. */
  cli(provider: AgentProviderId): AgentCliInfo | undefined;
  defaultEmail(provider: AgentProviderId): string | null;
  /** The provider's saved API key. */
  apiKey(provider: AgentProviderId): string | null;
  /** Whether the provider's own sign-in runs on its saved key, as it does with no account of its own. */
  defaultUsesApiKey(provider: AgentProviderId): boolean;
  /** The temporary folder of an ACP sign-in process, as the provider's own sign-in gets it. */
  signInTemp(provider: AgentProviderId): ProviderTempOptions | undefined;
  /**
   * Starts and checks a client that signs in to the account's folder. The caller stops it.
   * `afterSignIn`: the check that ends a sign-in, which gets the long start wait.
   */
  authenticate(
    provider: AgentProviderId,
    cli: AgentCliInfo,
    accountEnvironment: Readonly<Record<string, string>>,
    afterSignIn?: boolean,
  ): Effect.Effect<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }, ProviderAccountFailed>;
  stopClient(client: AgentClient): Effect.Effect<void>;
  /** The running process of an agent on this account, if there is one. */
  agentClient(provider: AgentProviderId, accountId: string): AgentClient | null;
  /** Whether an agent on this account runs a turn. */
  isAccountBusy(provider: AgentProviderId, accountId: string): boolean;
  stopAgentClients(provider: AgentProviderId, accountId: string): Effect.Effect<void>;
  readUsage(client: AgentClient, model?: string): Effect.Effect<AccountUsage, ProviderAccountFailed>;
  /** The usage reset credits that the client's last usage reading counted; undefined for a provider with none. */
  resetCredits(client: AgentClient): number | null | undefined;
  consumeUsageReset(client: AgentClient): Effect.Effect<ProviderUsageResetOutcome, ProviderAccountFailed>;
  changed(): void;
  /** Sends the reading of an account check: after a sign-in, and when the provider's own sign-in connects. */
  usageChanged(limit: AccountUsageLimit): void;
  redact(text: string): string;
}

/**
 * The provider accounts after the first: their sign-in, check, usage and removal. Each one signs in
 * to a folder of its own, with the same CLI as the provider's own sign-in. An agent on one of them
 * runs on its own process; the provider runtime starts that process with `environment`.
 */
export class ProviderAccounts {
  readonly #store: ProviderAccountStore;
  readonly #host: ProviderAccountsHost;
  readonly #states = new Map<string, AccountState>();
  readonly #signIns = new Map<string, Fiber.Fiber<string | null>>();
  /** Accounts whose first sign-in runs. A cancel removes them with their folder. */
  readonly #added = new Set<string>();
  readonly #checks = new Map<string, Fiber.Fiber<void>>();
  /** The last usage reading of each account, with the usage reset credits it counted. */
  readonly #usage = new Map<string, { limit: AccountUsageLimit; resetCredits: number | null | undefined }>();
  /** Paces the usage reads of each account. A new key resets it, and a removed account drops it. */
  readonly #usageGates = new Map<string, UsageReadGate>();

  constructor(store: ProviderAccountStore, host: ProviderAccountsHost) {
    this.#store = store;
    this.#host = host;
  }

  static support(provider: AgentProviderId): ProviderAccountSupport | undefined {
    return provider === "acp" ? undefined : requireProviderDriver(provider).accounts;
  }

  /** The stored account an agent names, or null for the provider's own sign-in or a removed account. */
  account(provider: AgentProviderId, accountId: string | undefined): StoredProviderAccount | null {
    if (!accountId || accountId === DEFAULT_PROVIDER_ACCOUNT_ID || !ProviderAccounts.support(provider)) return null;
    return this.#store.get(provider, accountId);
  }

  /** The variable that points the CLI at the account's folder, and the key of a key account. */
  environment(account: StoredProviderAccount): Readonly<Record<string, string>> {
    const support = ProviderAccounts.support(account.provider);
    if (!support) throw new Error("Invalid provider account.");
    const key = isKeyAccount(account) ? this.#host.apiKey(account.provider) : null;
    return { [support.homeVariable]: this.#store.home(account), ...(key ? { ANTHROPIC_API_KEY: key } : {}) };
  }

  /** Whether the provider's connected CLI can hold accounts after the first. */
  supported(provider: AgentProviderId): boolean {
    return this.#support(provider) !== undefined;
  }

  /** The support of a provider whose connected CLI reads the home folder variable. */
  #support(provider: AgentProviderId): ProviderAccountSupport | undefined {
    const support = ProviderAccounts.support(provider);
    if (!support?.supports) return support;
    const cli = this.#host.cli(provider);
    return cli && support.supports(cli) ? support : undefined;
  }

  /** The rows of a connected provider that can hold more than one account; its own sign-in first. */
  rows(provider: AgentProviderId, defaultEmail: string | null): ProviderAccountStatus[] | undefined {
    if (!this.#support(provider)) return undefined;
    return [
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        label: this.#store.defaultLabel(provider),
        email: defaultEmail,
        state: "connected",
        message: null,
      },
      // With no claude.ai account, the own sign-in runs on the key too: one row is enough.
      ...this.#store
        .list(provider)
        .filter((account) => !isKeyAccount(account) || !this.#host.defaultUsesApiKey(provider))
        .map((account) => {
          const state = this.#states.get(account.id);
          return {
            id: account.id,
            label: account.label,
            email: state?.email ?? null,
            state: state?.state ?? "checking",
            message: state?.message ?? null,
          };
        }),
    ];
  }

  /**
   * Signs an account in through the browser: a new one when `accountId` is null. Answers when the
   * sign-in starts, with the account and a wait for the sign-in's end: its error, or null. The
   * account row also reports how it ends. A new account that does not finish is removed with its
   * folder.
   */
  readonly connect = Effect.fn("ProviderAccounts.connect")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
  ) {
    const support = this.#support(provider);
    const name = providerLabel(provider);
    if (!support) return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    const cli = this.#host.cli(provider);
    if (!cli) return yield* accountFailure(sourceText("error.provider.accountNeedsConnection", { provider: name }));
    let account: StoredProviderAccount;
    const added = accountId === null;
    if (added) {
      const created = yield* this.#store
        .create(provider)
        .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
      if (!created)
        return yield* accountFailure(
          sourceText("error.provider.accountLimit", { provider: name, limit: MAX_PROVIDER_ACCOUNTS }),
        );
      account = created;
    } else {
      const stored = this.account(provider, accountId);
      if (!stored) return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
      // A client without claude-api-key-v1 shows the key account as a signed-out account.
      if (isKeyAccount(stored))
        return yield* accountFailure(sourceText("error.provider.accountUsesKey", { provider: name }));
      account = stored;
    }
    const command = support.signIn;
    if (!added && "kind" in command) {
      // The sign-out removes the token that the account's processes use.
      if (this.#host.isAccountBusy(provider, account.id))
        return yield* accountFailure(sourceText("error.provider.cliBusyReconnect", { provider: name }));
      yield* this.#host.stopAgentClients(provider, account.id);
    }
    yield* this.#interrupt(account.id);
    if (added) this.#added.add(account.id);
    this.#setState(account.id, { state: "connecting", message: null });
    const signIn = Effect.scoped(
      Effect.gen({ self: this }, function* () {
        if ("kind" in command) {
          // A Reconnect signs the account out first: its saved token would answer with no browser page.
          // The server prints Google's page, which a host shows and this computer opens itself.
          const login = yield* startAcpAuthentication({
            executable: cli.executable,
            argv: command.argv,
            env: { ...cliPathEnvironment(cli), ...command.env, ...this.environment(account) },
            methodId: command.methodId,
            timeoutMs: command.timeoutMs,
            ...(added ? {} : { logout: true }),
            privateTemp: this.#host.signInTemp(provider),
            openGoogleSignIn: openExternal,
          });
          return yield* login.done;
        }
        const browser = onHost ? yield* captureBrowser(openExternal) : {};
        const target = cliSpawnTarget(cli.executable, command.argv);
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(target.command, target.args, {
              cwd: process.cwd(),
              env: {
                ...process.env,
                ...cliPathEnvironment(cli),
                ...command.env(cli),
                ...this.environment(account),
                ...browser,
              },
              stdio: "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
              windowsVerbatimArguments: target.windowsVerbatimArguments,
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSuccessfulProcess(child, command.timeoutMs);
      }),
    ).pipe(
      Effect.andThen(this.#check(account, true)),
      Effect.onError((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              const message = this.#message(provider, Cause.squash(cause));
              logger.warn("A provider account did not sign in.", { provider, message });
              if (added) {
                // A sign-in that ended before its check failed can have left a credential outside the folder.
                yield* this.#signOut(account).pipe(Effect.ignore);
                yield* this.#store.remove(account).pipe(Effect.ignore);
                this.#forget(account.id);
                this.#host.changed();
                return;
              }
              this.#setState(account.id, { state: "error", message });
            }),
      ),
      Effect.as<string | null>(null),
      Effect.catch((error) => Effect.succeed(this.#message(provider, error))),
      Effect.ensuring(
        Effect.sync(() => {
          this.#signIns.delete(account.id);
          this.#added.delete(account.id);
        }),
      ),
    );
    const fiber = yield* signIn.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
    // A sign-in that already ended has removed itself; do not hold its fiber.
    if (fiber.pollUnsafe() === undefined) this.#signIns.set(account.id, fiber);
    return { accountId: account.id, signIn: fiber, ended: Fiber.join(fiber) };
  }).bind(this);

  /**
   * Stops the sign-in of an account. A new account goes with its folder; one that was signed in
   * before is signed out.
   */
  readonly cancel = Effect.fn("ProviderAccounts.cancel")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    /** Only this sign-in: a later sign-in of the same account goes on. */
    signIn?: Fiber.Fiber<string | null>,
  ) {
    const account = this.account(provider, accountId);
    const running = this.#signIns.get(accountId);
    if (!account || !running || (signIn && running !== signIn)) return;
    const added = this.#added.has(accountId);
    logger.info("A provider account sign-in was canceled.", { provider, accountId, added });
    yield* this.#interrupt(accountId);
    if (!added) {
      this.#setState(accountId, { state: "signed-out", message: null });
      return;
    }
    yield* this.#signOut(account).pipe(Effect.ignore);
    yield* this.#store.remove(account).pipe(Effect.ignore);
    this.#forget(accountId);
    this.#host.changed();
  }).bind(this);

  readonly rename = Effect.fn("ProviderAccounts.rename")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    label: string | null,
  ) {
    const name = providerLabel(provider);
    if (!ProviderAccounts.support(provider))
      return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    if (accountId !== DEFAULT_PROVIDER_ACCOUNT_ID && !this.account(provider, accountId))
      return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
    yield* this.#store
      .rename(provider, accountId, label)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#host.changed();
  }).bind(this);

  /**
   * Stops the account's processes, signs it out, and removes its folder with the credentials in it.
   * The caller moves its agents to the provider's own sign-in first.
   */
  readonly remove = Effect.fn("ProviderAccounts.remove")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
  ) {
    const name = providerLabel(provider);
    if (accountId === DEFAULT_PROVIDER_ACCOUNT_ID)
      return yield* accountFailure(sourceText("error.provider.accountDefault", { provider: name }));
    const account = this.account(provider, accountId);
    if (!account) return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
    yield* this.#interrupt(account.id);
    yield* this.#host.stopAgentClients(provider, account.id);
    yield* this.#signOut(account);
    yield* this.#store
      .remove(account)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#forget(account.id);
    this.#host.changed();
  }).bind(this);

  /**
   * Checks each account of a provider whose own sign-in just connected, unless a check is recent. A
   * saved key gets its account first.
   */
  checkAll(provider: AgentProviderId): Effect.Effect<void> {
    if (!this.#support(provider)) return Effect.void;
    return Effect.gen({ self: this }, function* () {
      yield* this.#ensureKeyAccount(provider);
      const now = Date.now();
      yield* Effect.forEach(
        this.#store
          .list(provider)
          .filter(
            (account) =>
              !this.#signIns.has(account.id) &&
              !this.#checks.has(account.id) &&
              now - (this.#states.get(account.id)?.checkedAt ?? 0) >= ACCOUNT_CHECK_TTL_MS,
          ),
        (account) => this.#startCheck(account),
        { discard: true },
      );
    });
  }

  /**
   * After the provider's key changed: a saved key gets its account and a new check, as the key can be
   * wrong. The caller moves the agents off the account of a removed key and removes it.
   */
  keyChanged(provider: AgentProviderId): Effect.Effect<void> {
    if (!this.#support(provider)) return Effect.void;
    return Effect.gen({ self: this }, function* () {
      const account = yield* this.#ensureKeyAccount(provider);
      if (!account) return;
      yield* this.#interrupt(account.id);
      this.#usage.delete(account.id);
      this.#usageGate(account.id).reset();
      yield* this.#startCheck(account);
    });
  }

  /** The account of a saved key; null with no key, or when the provider has no room for it. */
  #ensureKeyAccount(provider: AgentProviderId): Effect.Effect<StoredProviderAccount | null> {
    if (provider !== "claude" || !this.#host.apiKey(provider)) return Effect.succeed(null);
    return this.#store.ensure(provider, CLAUDE_API_KEY_ACCOUNT_ID).pipe(
      Effect.tap((account) =>
        Effect.sync(() => {
          if (!account) logger.warn("No room for the account of a saved key.", { provider });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("Could not add the account of a saved key.", {
            provider,
            message: this.#message(provider, error.cause),
          });
          return null;
        }),
      ),
    );
  }

  #startCheck(account: StoredProviderAccount): Effect.Effect<void> {
    const provider = account.provider;
    return Effect.gen({ self: this }, function* () {
      const check = this.#check(account).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            const error = Cause.squash(cause);
            const signedOut = error instanceof ProviderSignInError || isSignInError(error);
            this.#setState(account.id, {
              state: signedOut ? "signed-out" : "error",
              message: signedOut
                ? sourceText("error.provider.accountSignedOut", { provider: providerLabel(provider) })
                : this.#message(provider, error),
            });
          }),
        ),
        Effect.ensuring(Effect.sync(() => this.#checks.delete(account.id))),
      );
      const fiber = yield* check.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
      if (fiber.pollUnsafe() === undefined) this.#checks.set(account.id, fiber);
    });
  }

  /**
   * The usage of each connected account of a provider that reports usage. Each account's gate decides
   * when it is read again; until then, or when a read fails, the kept reading answers. A read takes an
   * agent's process or a short check.
   */
  readonly usage = Effect.fn("ProviderAccounts.usage")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    model: string | undefined,
  ) {
    const limits: AccountUsageLimit[] = [];
    if (!this.#support(provider)) return limits;
    for (const account of this.#store.list(provider)) {
      // A key has no plan, so no usage to read.
      if (isKeyAccount(account) || this.#states.get(account.id)?.state !== "connected") continue;
      const kept = () => this.#usage.get(account.id)?.limit ?? null;
      const limit = yield* this.#usageGate(account.id)
        .run({
          read: this.#readUsage(account, model),
          kept,
          stale: (readAt) => {
            const reading = kept();
            return reading !== null && usageWindowResetSince(reading, readAt);
          },
        })
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              logger.warn("Could not read provider account usage.", {
                provider,
                message: this.#message(provider, error),
              });
              return kept();
            }),
          ),
        );
      if (limit) limits.push(limit);
    }
    return limits;
  }).bind(this);

  /** The reading of one account for the usage limit check: its agent's process, or the kept one. */
  readonly usageFor = Effect.fn("ProviderAccounts.usageFor")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    model: string,
  ) {
    const client = this.#host.agentClient(provider, accountId);
    if (client) return yield* this.#host.readUsage(client, model);
    // The kept reading has no model: take the windows of the model's quota group from it.
    const kept = this.#usage.get(accountId)?.limit;
    const quota = kept && usageQuotaForModel(kept, model);
    return {
      limits: kept && quota ? [{ ...kept, primary: quota.primary, secondary: quota.secondary }] : [],
    } satisfies AccountUsage;
  }).bind(this);

  /**
   * The usage reset credits of each connected account of a provider, from the readings that `usage`
   * keeps or reads again. An account whose provider could not count its credits is left out.
   */
  readonly usageResets = Effect.fn("ProviderAccounts.usageResets")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    model: string | undefined,
  ) {
    yield* this.usage(provider, model);
    return this.#store.list(provider).flatMap((account): ProviderUsageResets[] => {
      if (this.#states.get(account.id)?.state !== "connected") return [];
      const available = this.#usage.get(account.id)?.resetCredits;
      return typeof available === "number" ? [{ provider, accountId: account.id, available }] : [];
    });
  }).bind(this);

  /**
   * Spends one usage reset credit of an account, through its agent's process or a short one, then
   * reads its usage again. `limit` is that reading, or null when the provider gave none.
   */
  readonly resetUsage = Effect.fn("ProviderAccounts.resetUsage")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    model: string | undefined,
  ) {
    const account = this.#store.get(provider, accountId);
    const cli = this.#host.cli(provider);
    if (!account || this.#states.get(accountId)?.state !== "connected" || !cli)
      return yield* accountFailure(
        sourceText("error.provider.usageResetNotConnected", { provider: providerLabel(provider) }),
      );
    const reset = (client: AgentClient) =>
      Effect.gen({ self: this }, function* () {
        const outcome = yield* this.#host.consumeUsageReset(client);
        const limit = yield* this.#host.readUsage(client, model).pipe(
          Effect.flatMap((usage) => this.#storeUsage(account, client, usage)),
          Effect.catch(() => Effect.succeed(null)),
        );
        return { outcome, limit };
      });
    const running = this.#host.agentClient(provider, accountId);
    if (running) return yield* reset(running);
    return yield* Effect.acquireUseRelease(
      this.#host.authenticate(provider, cli, this.environment(account)),
      ({ client }) => reset(client),
      ({ client }) => this.#host.stopClient(client),
    );
  }).bind(this);

  /** Starts a client in the account's folder, reads who it is and its usage, and stops it. */
  readonly #check = Effect.fn("ProviderAccounts.check")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
    afterSignIn = false,
  ) {
    const provider = account.provider;
    const cli = this.#host.cli(provider);
    if (!cli)
      return yield* accountFailure(
        sourceText("error.provider.accountNeedsConnection", { provider: providerLabel(provider) }),
      );
    if (this.#states.get(account.id)?.state !== "connecting")
      this.#setState(account.id, { state: "checking", message: null });
    yield* Effect.acquireUseRelease(
      this.#host.authenticate(provider, cli, this.environment(account), afterSignIn),
      ({ client, account: signedIn }) =>
        Effect.gen({ self: this }, function* () {
          const email = signedIn.email ?? null;
          if (email && this.#emailTaken(provider, account.id, email))
            return yield* accountFailure(
              sourceText("error.provider.accountAlreadyAdded", { provider: providerLabel(provider) }),
            );
          // The reading comes first: a usage request for a connected account uses it and starts no client.
          const reading = this.#host
            .readUsage(client, defaultUsageModel(provider))
            .pipe(Effect.flatMap((usage) => this.#storeUsage(account, client, usage)));
          // After a sign-in, the client is signed in already, so a reading that fails does not fail the
          // check: that failure removed the new account.
          const limit =
            agentProviderDescriptor(provider).reportsUsage && !isKeyAccount(account)
              ? yield* afterSignIn
                  ? reading.pipe(
                      Effect.catch((error) =>
                        Effect.sync(() => {
                          logger.warn("A provider account usage reading failed after its sign-in.", {
                            provider,
                            message: this.#message(provider, error),
                          });
                          return null;
                        }),
                      ),
                    )
                  : reading
              : null;
          this.#setState(account.id, { state: "connected", email, message: null });
          // The rail shows an account only with a reading, and no usage request follows a sign-in.
          if (limit) this.#host.usageChanged(limit);
        }),
      ({ client }) => this.#host.stopClient(client),
    );
  });

  readonly #readUsage = Effect.fn("ProviderAccounts.readUsage")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
    model: string | undefined,
  ) {
    const running = this.#host.agentClient(account.provider, account.id);
    if (running) return yield* this.#storeUsage(account, running, yield* this.#host.readUsage(running, model));
    if (ProviderAccounts.support(account.provider)?.usageLeavesSession)
      return this.#usage.get(account.id)?.limit ?? null;
    const cli = this.#host.cli(account.provider);
    if (!cli) return null;
    return yield* Effect.acquireUseRelease(
      this.#host.authenticate(account.provider, cli, this.environment(account)),
      ({ client }) =>
        Effect.gen({ self: this }, function* () {
          return yield* this.#storeUsage(account, client, yield* this.#host.readUsage(client, model));
        }),
      ({ client }) => this.#host.stopClient(client),
    );
  });

  #storeUsage(
    account: StoredProviderAccount,
    client: AgentClient,
    usage: AccountUsage,
  ): Effect.Effect<AccountUsageLimit | null> {
    return Effect.sync(() => {
      const first = usage.limits[0];
      if (!first || (!first.primary && !first.secondary)) return null;
      const limit = { ...first, id: account.provider, accountId: account.id };
      this.#usage.set(account.id, { limit, resetCredits: this.#host.resetCredits(client) });
      // Also a reading of an account check or a reset counts, so the next poll does not read again.
      this.#usageGate(account.id).succeeded();
      return limit;
    });
  }

  /**
   * Signs the provider's own sign-in out: the CLI's sign-out in the user's own home folder, which a
   * terminal CLI on the same computer shares. The caller stops the client that still runs on it.
   */
  readonly signOutDefault = Effect.fn("ProviderAccounts.signOutDefault")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
  ) {
    const command = ProviderAccounts.support(provider)?.signOut;
    const cli = this.#host.cli(provider);
    if (!command || !cli)
      return yield* accountFailure(
        sourceText("error.provider.signOutUnsupported", { provider: providerLabel(provider) }),
      );
    yield* this.#runSignOut(cli, command, {}).pipe(
      Effect.mapError((error) => accountFailure(this.#message(provider, error))),
    );
  });

  /** Runs the CLI's sign-out in the account's folder, for a CLI that keeps a credential outside it. */
  readonly #signOut = Effect.fn("ProviderAccounts.signOut")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
  ) {
    const command = ProviderAccounts.support(account.provider)?.signOut;
    const cli = this.#host.cli(account.provider);
    // A key account never signed in; the key goes with the stored credential.
    if (!command || !cli || isKeyAccount(account)) return;
    yield* this.#runSignOut(cli, command, this.environment(account)).pipe(
      // The folder goes in any case; a credential the CLI kept elsewhere is the CLI's to clear.
      Effect.catch((error) =>
        Effect.sync(() =>
          logger.warn("A provider account did not sign out.", {
            provider: account.provider,
            message: this.#message(account.provider, error),
          }),
        ),
      ),
    );
  });

  #runSignOut(
    cli: AgentCliInfo,
    command: NonNullable<ProviderAccountSupport["signOut"]>,
    environment: Readonly<Record<string, string>>,
  ): Effect.Effect<void, ProviderProcessFailed> {
    return Effect.scoped(
      Effect.gen(function* () {
        const target = cliSpawnTarget(cli.executable, command.argv);
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(target.command, target.args, {
              cwd: process.cwd(),
              env: { ...process.env, ...cliPathEnvironment(cli), ...command.env(cli), ...environment },
              stdio: "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
              windowsVerbatimArguments: target.windowsVerbatimArguments,
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSuccessfulProcess(child, command.timeoutMs, "Provider sign-out");
      }),
    );
  }

  #emailTaken(provider: AgentProviderId, accountId: string, email: string): boolean {
    const normalized = email.toLowerCase();
    if (this.#host.defaultEmail(provider)?.toLowerCase() === normalized) return true;
    return this.#store
      .list(provider)
      .some((other) => other.id !== accountId && this.#states.get(other.id)?.email?.toLowerCase() === normalized);
  }

  #interrupt(accountId: string): Effect.Effect<void> {
    const fibers = [this.#signIns.get(accountId), this.#checks.get(accountId)].filter((fiber) => fiber !== undefined);
    this.#signIns.delete(accountId);
    this.#checks.delete(accountId);
    return Fiber.interruptAll(fibers);
  }

  #forget(accountId: string): void {
    this.#states.delete(accountId);
    this.#usage.delete(accountId);
    this.#usageGates.delete(accountId);
  }

  #usageGate(accountId: string): UsageReadGate {
    let gate = this.#usageGates.get(accountId);
    if (!gate) {
      gate = new UsageReadGate();
      this.#usageGates.set(accountId, gate);
    }
    return gate;
  }

  #setState(accountId: string, patch: Partial<Omit<AccountState, "checkedAt">>): void {
    const current = this.#states.get(accountId);
    // The state only: the message and email can hold what the CLI printed.
    if (patch.state && patch.state !== current?.state)
      logger.info("A provider account changed state.", { accountId, from: current?.state ?? null, to: patch.state });
    this.#states.set(accountId, {
      state: patch.state ?? current?.state ?? "checking",
      email: patch.email !== undefined ? patch.email : (current?.email ?? null),
      message: patch.message !== undefined ? patch.message : (current?.message ?? null),
      checkedAt: patch.state === "connected" || patch.state === "signed-out" ? Date.now() : (current?.checkedAt ?? 0),
    });
    this.#host.changed();
  }

  /** A failure as the account row shows it: the CLI's own words, with every secret taken out. */
  #message(provider: AgentProviderId, error: unknown): string {
    const cause = error instanceof ProviderAccountFailed ? error.cause : error;
    const text = cause instanceof Error ? cause.message : String(cause);
    return shortenDiagnostic(this.#host.redact(text)) || providerLabel(provider);
  }
}

/** The account that a saved key runs on. */
function isKeyAccount(account: StoredProviderAccount): boolean {
  return account.provider === "claude" && account.id === CLAUDE_API_KEY_ACCOUNT_ID;
}

function isSignInError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    (error.cause instanceof ProviderSignInError || isSignInError(error.cause))
  );
}

export function defaultUsageModel(provider: AgentProviderId): string | undefined {
  return provider === "codex" ? undefined : agentProviderDescriptor(provider).defaultModel || undefined;
}
