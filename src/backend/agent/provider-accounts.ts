import { spawn } from "node:child_process";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import {
  type AccountUsage,
  type AccountUsageLimit,
  type AgentModelOption,
  agentProviderDescriptor,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  MAX_PROVIDER_ACCOUNTS,
  type ProviderAccountCodeLoginStart,
  type ProviderAccountCodeLoginStatus,
  type ProviderAccountState,
  type ProviderAccountStatus,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  usageQuotaForModel,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, type Scope } from "effect";
import { googleSignInByOpenBot, startAcpAuthentication } from "./../acp-sign-in";
import type { AgentClient } from "./../agent-client";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "./../cli";
import { type AccountReadResult, CLAUDE_CLI_API_KEY_ACCOUNT_TYPE } from "./../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import {
  isKeyAccountSupport,
  type ProviderAccountSupport,
  type ProviderHomeAccountSupport,
  requireProviderDriver,
} from "./../provider-drivers";
import type { ProviderTempOptions } from "./../provider-temp";
import { shortenDiagnostic } from "./../stderr-diagnostics";
import { stopProcessTree } from "../windows-process-tree";
import { usageWindowResetSince } from "./account-usage";
import { captureBrowser, signInPageByOpenBot } from "./browser-capture";
import { type CliCodeLogin, type CliCodePrompt, pasteCodeLoginSupported, startCliCodeLogin } from "./cli-code-login";
import type { ProviderAccountStore, StoredProviderAccount } from "./provider-account-store";
import { ProviderProcessFailed, waitForSignInProcess, waitForSuccessfulProcess } from "./provider-status";
import { providerLabel } from "./thread-items";
import { UsageReadGate } from "./usage-read-gate";

const logger = createOpenBotLogger("provider-accounts");

const ACCOUNT_CHECK_TTL_MS = 5 * 60_000;

export class ProviderAccountFailed extends Schema.TaggedError<ProviderAccountFailed>()("ProviderAccountFailed", {
  cause: Schema.Defect(),
}) {}

function accountFailure(text: string): ProviderAccountFailed {
  return new ProviderAccountFailed({ cause: new Error(text) });
}

export function ownApiKeyNotice(account: AccountReadResult["account"] | undefined): string | null {
  return account?.type === CLAUDE_CLI_API_KEY_ACCOUNT_TYPE ? sourceText("status.provider.claudeOwnApiKey") : null;
}

interface AccountLogin {
  email: string | null;
  organization: string | null;
}

interface AccountState {
  state: ProviderAccountState;
  email: string | null;
  organization: string | null;
  message: string | null;
  checkedAt: number;
}

export interface ProviderAccountsHost {
  scope(): Scope.Scope;
  cli(provider: AgentProviderId): AgentCliInfo | undefined;
  defaultLogin(provider: AgentProviderId): AccountLogin | null;
  apiKey(provider: AgentProviderId): string | null;
  accountKey(provider: AgentProviderId, accountId: string): string | null;
  saveAccountKey(
    provider: AgentProviderId,
    accountId: string,
    key: string | null,
  ): Effect.Effect<void, ProviderAccountFailed>;
  defaultUsesApiKey(provider: AgentProviderId): boolean;
  signInTemp(provider: AgentProviderId): ProviderTempOptions | undefined;
  authenticate(
    provider: AgentProviderId,
    cli: AgentCliInfo,
    accountEnvironment: Readonly<Record<string, string>>,
    longStart?: boolean,
  ): Effect.Effect<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }, ProviderAccountFailed>;
  stopClient(client: AgentClient): Effect.Effect<void>;
  agentClient(provider: AgentProviderId, accountId: string): AgentClient | null;
  isAccountBusy(provider: AgentProviderId, accountId: string): boolean;
  stopAgentClients(provider: AgentProviderId, accountId: string): Effect.Effect<void>;
  readUsage(client: AgentClient, model?: string): Effect.Effect<AccountUsage, ProviderAccountFailed>;
  readModels(client: AgentClient): Effect.Effect<AgentModelOption[] | null>;
  resetCredits(client: AgentClient): number | null | undefined;
  consumeUsageReset(client: AgentClient): Effect.Effect<ProviderUsageResetOutcome, ProviderAccountFailed>;
  changed(): void;
  modelsListed?(provider: AgentProviderId, accountId: string): Effect.Effect<void>;
  signedIn?(provider: AgentProviderId, accountId: string): Effect.Effect<void>;
  usageChanged(limit: AccountUsageLimit): void;
  redact(text: string): string;
}

export class ProviderAccounts {
  readonly #store: ProviderAccountStore;
  readonly #host: ProviderAccountsHost;
  readonly #states = new Map<string, AccountState>();
  readonly #signIns = new Map<string, Fiber.Fiber<string | null>>();
  readonly #added = new Set<string>();
  readonly #codeResults = new Map<string, { error: string | null }>();
  readonly #codeSignIns = new Set<string>();
  readonly #pasteLogins = new Map<string, CliCodeLogin>();
  readonly #checks = new Map<string, Fiber.Fiber<void>>();
  readonly #usage = new Map<string, { limit: AccountUsageLimit; resetCredits: number | null | undefined }>();
  readonly #usageGates = new Map<string, UsageReadGate>();
  readonly #models = new Map<string, AgentModelOption[]>();

  constructor(store: ProviderAccountStore, host: ProviderAccountsHost) {
    this.#store = store;
    this.#host = host;
  }

  static support(provider: AgentProviderId): ProviderAccountSupport | undefined {
    return provider === "acp" ? undefined : requireProviderDriver(provider).accounts;
  }

  static signOutCommand(provider: AgentProviderId): ProviderHomeAccountSupport["signOut"] {
    return homeSupport(provider)?.signOut ?? requireProviderDriver(provider).signOut;
  }

  account(provider: AgentProviderId, accountId: string | undefined): StoredProviderAccount | null {
    if (!accountId || accountId === DEFAULT_PROVIDER_ACCOUNT_ID || !ProviderAccounts.support(provider)) return null;
    return this.#store.get(provider, accountId);
  }

  environment(account: StoredProviderAccount): Readonly<Record<string, string>> {
    const support = ProviderAccounts.support(account.provider);
    if (!support) throw new Error("Invalid provider account.");
    if (isKeyAccountSupport(support))
      return support.keyEnvironment(this.#host.accountKey(account.provider, account.id) ?? "");
    const key = isKeyAccount(account) ? this.#host.apiKey(account.provider) : null;
    return { [support.homeVariable]: this.#store.home(account), ...(key ? { ANTHROPIC_API_KEY: key } : {}) };
  }

  supported(provider: AgentProviderId): boolean {
    return this.#support(provider) !== undefined;
  }

  #support(provider: AgentProviderId): ProviderAccountSupport | undefined {
    const support = ProviderAccounts.support(provider);
    if (!support?.supports) return support;
    const cli = this.#host.cli(provider);
    return cli && support.supports(cli) ? support : undefined;
  }

  rows(
    provider: AgentProviderId,
    defaultEmail: string | null,
    defaultMessage: string | null,
  ): ProviderAccountStatus[] | undefined {
    if (!this.#support(provider)) return undefined;
    return [
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        label: this.#store.defaultLabel(provider),
        email: defaultEmail,
        state: "connected",
        message: defaultMessage,
      },
      ...this.#store
        .list(provider)
        .filter((account) => !isKeyAccount(account) || !this.#host.defaultUsesApiKey(provider))
        .map((account) => {
          const state = this.#states.get(account.id);
          const models = this.#models.get(account.id);
          return {
            id: account.id,
            label: account.label,
            email: state?.email ?? null,
            state: state?.state ?? "checking",
            message: state?.message ?? null,
            ...(models ? { models: structuredClone(models) } : {}),
          };
        }),
    ];
  }

  models(provider: AgentProviderId, accountId: string | undefined): AgentModelOption[] {
    return this.listedModels(provider, accountId) ?? [];
  }

  listedModels(provider: AgentProviderId, accountId: string | undefined): AgentModelOption[] | null {
    const account = this.account(provider, accountId);
    if (!account) return [];
    const models = this.#models.get(account.id);
    return models ? structuredClone(models) : null;
  }

  readonly connect = Effect.fn("ProviderAccounts.connect")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
    onHost: boolean,
    code?: Deferred.Deferred<CliCodePrompt | null>,
  ) {
    const support = this.#support(provider);
    const name = providerLabel(provider);
    if (!support) return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    if (isKeyAccountSupport(support))
      return yield* accountFailure(sourceText("error.provider.accountNeedsKey", { provider: name }));
    const cli = this.#host.cli(provider);
    if (!cli) return yield* accountFailure(sourceText("error.provider.accountNeedsConnection", { provider: name }));
    if (code && !support.codeSignIn)
      return yield* accountFailure(sourceText("error.provider.noCodeSignIn", { provider: name }));
    if (
      code &&
      support.codeSignIn?.flow === "paste" &&
      !support.codeSignIn.command.pipedInput &&
      !pasteCodeLoginSupported()
    )
      return yield* accountFailure(sourceText("error.provider.codeLoginUnsupported"));
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
      if (isKeyAccount(stored))
        return yield* accountFailure(sourceText("error.provider.accountUsesKey", { provider: name }));
      account = stored;
    }
    const command = support.signIn;
    const codeSignIn = code ? support.codeSignIn : undefined;
    if (!added && !codeSignIn && "kind" in command) {
      if (this.#host.isAccountBusy(provider, account.id))
        return yield* accountFailure(sourceText("error.provider.cliBusyReconnect", { provider: name }));
      yield* this.#host.stopAgentClients(provider, account.id);
    }
    yield* this.#interrupt(account.id);
    if (added) this.#added.add(account.id);
    else {
      this.#usage.delete(account.id);
      this.#usageGate(account.id).reset();
    }
    if (code) {
      this.#codeResults.delete(account.id);
      this.#codeSignIns.add(account.id);
    }
    this.#setState(account.id, { state: "connecting", message: null });
    const signIn = Effect.scoped(
      Effect.gen({ self: this }, function* () {
        if (code && codeSignIn) {
          const { argv, closeInput, pipedInput } = codeSignIn.command;
          const env = { ...cliPathEnvironment(cli), ...codeSignIn.command.env(cli), ...this.environment(account) };
          const login = yield* startCliCodeLogin({
            flow: codeSignIn.flow,
            executable: cli.executable,
            argv: typeof argv === "function" ? argv({ ...process.env, ...env }) : argv,
            env,
            timeoutMs: codeSignIn.command.timeoutMs,
            ...(closeInput ? { closeInput: true } : {}),
            ...(pipedInput ? { pipedInput: true } : {}),
          }).pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
          const prompt = yield* login.prompt.pipe(
            Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })),
          );
          if (prompt?.flow === "paste") {
            this.#pasteLogins.set(account.id, login);
            yield* Effect.addFinalizer(() => Effect.sync(() => this.#pasteLogins.delete(account.id)));
          }
          yield* Deferred.succeed(code, prompt);
          return yield* login.done.pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
        }
        if ("kind" in command) {
          const login = yield* startAcpAuthentication({
            executable: cli.executable,
            argv: command.argv,
            env: { ...cliPathEnvironment(cli), ...command.env, ...this.environment(account) },
            methodId: command.methodId,
            timeoutMs: command.timeoutMs,
            ...(added ? {} : { logout: true }),
            privateTemp: this.#host.signInTemp(provider),
            ...(googleSignInByOpenBot(onHost) ? { openSignInPage: { site: "google", open: openExternal } } : {}),
          });
          return yield* login.done;
        }
        const browser = signInPageByOpenBot(onHost, command) ? yield* captureBrowser(openExternal) : {};
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
              stdio: command.failureText ? ["ignore", "pipe", "pipe"] : "ignore",
              shell: false,
              windowsHide: process.platform === "win32",
              windowsVerbatimArguments: target.windowsVerbatimArguments,
            }),
          ),
          (child) => stopProcessTree(child).pipe(Effect.ignore),
        );
        yield* waitForSignInProcess(child, command).pipe(
          Effect.mapError((error) => (error.cause instanceof ProviderSignInError ? error.cause : error)),
        );
      }),
    ).pipe(
      Effect.andThen(this.#check(account, true)),
      Effect.andThen(this.#host.signedIn?.(provider, account.id) ?? Effect.void),
      Effect.onError((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              const message = this.#message(provider, Cause.squash(cause));
              logger.warn("A provider account did not sign in.", { provider, message });
              if (added) {
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
      Effect.tap((error) =>
        Effect.sync(() => {
          if (code) this.#codeResults.set(account.id, { error });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#signIns.delete(account.id);
          this.#added.delete(account.id);
          if (code) this.#codeSignIns.delete(account.id);
        }),
      ),
    );
    const fiber = yield* signIn.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
    if (fiber.pollUnsafe() === undefined) this.#signIns.set(account.id, fiber);
    return { accountId: account.id, signIn: fiber, ended: Fiber.join(fiber) };
  }).bind(this);

  readonly connectWithCode = Effect.fn("ProviderAccounts.connectWithCode")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string | null,
  ): Effect.fn.Return<ProviderAccountCodeLoginStart, ProviderAccountFailed> {
    const prompt = Deferred.makeUnsafe<CliCodePrompt | null>();
    const signIn = yield* this.connect(provider, accountId, () => Promise.resolve(), false, prompt);
    const support = this.#support(provider);
    const timeoutMs = support && !isKeyAccountSupport(support) ? (support.codeSignIn?.command.timeoutMs ?? 0) : 0;
    const expiresAt = Date.now() + timeoutMs;
    const first = yield* Effect.raceFirst(
      Deferred.await(prompt).pipe(Effect.map((printed) => ({ printed, error: null }))),
      Fiber.await(signIn.signIn).pipe(
        Effect.map((exit) => ({
          printed: null,
          error: Exit.isSuccess(exit)
            ? exit.value
            : sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) }),
        })),
      ),
    );
    if (first.error) return yield* accountFailure(first.error);
    const printed = first.printed;
    if (printed === null) return { accountId: signIn.accountId, start: { kind: "connected" } };
    if (printed.flow !== "device")
      return {
        accountId: signIn.accountId,
        start: { kind: printed.flow, verificationUrl: printed.verificationUrl, expiresAt },
      };
    return {
      accountId: signIn.accountId,
      start: {
        kind: "code",
        userCode: printed.userCode,
        verificationUrl: printed.verificationUrl,
        ...(printed.verificationUrlComplete ? { verificationUrlComplete: printed.verificationUrlComplete } : {}),
        expiresAt,
      },
    };
  }).bind(this);

  submitCode(provider: AgentProviderId, accountId: string, code: string): void {
    const login = this.account(provider, accountId) ? this.#pasteLogins.get(accountId) : undefined;
    if (!login) throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
    login.submit(code);
  }

  codeSignInStatus(provider: AgentProviderId, accountId: string): ProviderAccountCodeLoginStatus {
    if (this.#signIns.has(accountId)) {
      if (this.#codeSignIns.has(accountId)) return { result: null };
      return { result: { error: sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) }) } };
    }
    const ended = this.#codeResults.get(accountId);
    if (ended && (ended.error !== null || this.account(provider, accountId))) return { result: { error: ended.error } };
    return { result: { error: sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) }) } };
  }

  readonly connectKey = Effect.fn("ProviderAccounts.connectKey")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string | null,
    key: string,
  ) {
    const name = providerLabel(provider);
    if (!isKeyAccountSupport(this.#support(provider)))
      return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    if (!this.#host.cli(provider))
      return yield* accountFailure(sourceText("error.provider.accountNeedsConnection", { provider: name }));
    const added = accountId === null;
    const stored = added
      ? yield* this.#store
          .create(provider)
          .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })))
      : this.account(provider, accountId);
    if (!stored)
      return yield* accountFailure(
        added
          ? sourceText("error.provider.accountLimit", { provider: name, limit: MAX_PROVIDER_ACCOUNTS })
          : sourceText("error.provider.accountNotFound", { provider: name }),
      );
    const account = stored;
    const previous = added ? null : this.#host.accountKey(provider, account.id);
    const discard = Effect.gen({ self: this }, function* () {
      yield* this.#host.saveAccountKey(provider, account.id, null).pipe(Effect.ignore);
      yield* this.#store.remove(account).pipe(Effect.ignore);
      this.#forget(account.id);
      this.#host.changed();
    });
    if (!added) {
      if (this.#host.isAccountBusy(provider, account.id))
        return yield* accountFailure(sourceText("error.provider.cliBusyReconnect", { provider: name }));
      yield* this.#interrupt(account.id);
      yield* this.#host.stopAgentClients(provider, account.id);
    }
    yield* this.#host
      .saveAccountKey(provider, account.id, key)
      .pipe(Effect.tapError(() => (added ? discard : Effect.void)));
    this.#usage.delete(account.id);
    this.#setState(account.id, { state: "connecting", message: null });
    yield* this.#check(account, true).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        logger.warn("A provider account did not accept its key.", { provider, added });
        if (added) return discard;
        return this.#host
          .saveAccountKey(provider, account.id, previous)
          .pipe(Effect.ignore, Effect.andThen(this.#startCheck(account)));
      }),
      Effect.mapError((error) => accountFailure(this.#message(provider, signInCause(error) ?? error))),
    );
    yield* this.#host.signedIn?.(provider, account.id) ?? Effect.void;
    return account.id;
  }).bind(this);

  readonly cancel = Effect.fn("ProviderAccounts.cancel")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
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

  pool(provider: AgentProviderId): { leftOut: readonly string[] } | null {
    return this.#support(provider) ? this.#store.pool(provider) : null;
  }

  readonly setPool = Effect.fn("ProviderAccounts.setPool")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    enabled: boolean,
    leftOut: readonly string[],
  ) {
    const name = providerLabel(provider);
    if (provider === "acp" || !this.#support(provider))
      return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    const known = new Set([DEFAULT_PROVIDER_ACCOUNT_ID, ...this.#store.list(provider).map((account) => account.id)]);
    yield* this.#store
      .setPool(provider, enabled ? { leftOut: leftOut.filter((accountId) => known.has(accountId)) } : null)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#host.changed();
  }).bind(this);

  liveVoiceAccount(): string | null {
    if (!this.#support("codex")) return null;
    const accountId = this.#store.liveVoiceAccount();
    if (accountId === DEFAULT_PROVIDER_ACCOUNT_ID) return accountId;
    return accountId && this.#store.get("codex", accountId) ? accountId : null;
  }

  readonly setLiveVoiceAccount = Effect.fn("ProviderAccounts.setLiveVoiceAccount")(function* (
    this: ProviderAccounts,
    accountId: string | null,
  ) {
    const name = providerLabel("codex");
    if (!this.#support("codex"))
      return yield* accountFailure(sourceText("error.provider.accountsUnsupported", { provider: name }));
    const stored =
      accountId === null || accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? null : this.#store.get("codex", accountId);
    if (accountId !== null && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID && !stored)
      return yield* accountFailure(sourceText("error.provider.accountNotFound", { provider: name }));
    if (stored && isKeyAccount(stored))
      return yield* accountFailure(sourceText("error.provider.accountUsesKey", { provider: name }));
    yield* this.#store
      .setLiveVoiceAccount(accountId)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#host.changed();
  }).bind(this);

  planAccounts(provider: AgentProviderId): string[] {
    if (!this.#support(provider)) return [];
    return this.#store
      .list(provider)
      .filter((account) => !isKeyAccount(account) && this.#states.get(account.id)?.state === "connected")
      .map((account) => account.id);
  }

  keptUsage(accountId: string): AccountUsageLimit | null {
    return this.#usage.get(accountId)?.limit ?? null;
  }

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
    if (isKeyAccountSupport(ProviderAccounts.support(provider)))
      yield* this.#host.saveAccountKey(provider, account.id, null);
    yield* this.#store
      .remove(account)
      .pipe(Effect.mapError((error) => new ProviderAccountFailed({ cause: error.cause })));
    this.#forget(account.id);
    this.#host.changed();
  }).bind(this);

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

  foundSignedOut(account: StoredProviderAccount): string | null {
    if (this.#signIns.has(account.id)) return null;
    const message = signedOutMessage(account.provider);
    this.#setState(account.id, { state: "signed-out", message });
    return message;
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
              message: signedOut ? signedOutMessage(provider) : this.#message(provider, error),
            });
          }),
        ),
        Effect.ensuring(Effect.sync(() => this.#checks.delete(account.id))),
      );
      const fiber = yield* check.pipe(Effect.forkIn(this.#host.scope(), { startImmediately: true }));
      if (fiber.pollUnsafe() === undefined) this.#checks.set(account.id, fiber);
    });
  }

  readonly usage = Effect.fn("ProviderAccounts.usage")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    model: string | undefined,
  ) {
    const limits: AccountUsageLimit[] = [];
    if (!this.#support(provider)) return limits;
    for (const account of this.#store.list(provider)) {
      if (isKeyAccount(account)) continue;
      const kept = () => this.#usage.get(account.id)?.limit ?? null;
      const state = this.#states.get(account.id)?.state;
      if (state === "checking" || state === "error") {
        const reading = kept();
        if (reading && !usageWindowResetSince(reading, 0)) limits.push(reading);
        continue;
      }
      if (state !== "connected") continue;
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
      else if (homeSupport(provider)?.usageLeavesSession) {
        const reading = kept();
        limits.push(
          reading && !usageWindowResetSince(reading, 0)
            ? reading
            : { id: provider, accountId: account.id, primary: null, secondary: null, readFailed: true },
        );
      }
    }
    return limits;
  }).bind(this);

  readonly usageFor = Effect.fn("ProviderAccounts.usageFor")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
    accountId: string,
    model: string,
  ) {
    const client = this.#host.agentClient(provider, accountId);
    if (client)
      return yield* this.#usageGate(accountId).unlessWaiting({
        read: this.#host.readUsage(client, model),
        waiting: (): AccountUsage => ({ limits: [] }),
      });
    const kept = this.#usage.get(accountId)?.limit;
    const quota = kept && usageQuotaForModel(kept, model);
    return {
      limits: kept && quota ? [{ ...kept, primary: quota.primary, secondary: quota.secondary }] : [],
    } satisfies AccountUsage;
  }).bind(this);

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
    const support = ProviderAccounts.support(provider);
    if (isKeyAccountSupport(support) && support.checkKey) {
      const name = providerLabel(provider);
      const key = this.#host.accountKey(provider, account.id);
      const accepted = yield* (key ? support.checkKey(key) : Effect.succeed(false)).pipe(
        Effect.mapError((error) => {
          logger.warn("A provider did not answer a key check.", {
            provider,
            message: this.#message(provider, error.cause),
          });
          return accountFailure(sourceText("error.provider.accountKeyUnreachable", { provider: name }));
        }),
      );
      if (!accepted)
        return yield* new ProviderAccountFailed({
          cause: new ProviderSignInError({
            message: sourceText("error.provider.accountKeyRefused", { provider: name }),
          }),
        });
    }
    yield* Effect.acquireUseRelease(
      this.#host.authenticate(provider, cli, this.environment(account), true),
      ({ client, account: signedIn }) =>
        Effect.gen({ self: this }, function* () {
          const email = signedIn.email ?? null;
          const organization = signedIn.organization ?? null;
          if (afterSignIn && email && this.#loginTaken(provider, account.id, { email, organization })) {
            this.#usage.delete(account.id);
            return yield* accountFailure(
              sourceText("error.provider.accountAlreadyAdded", { provider: providerLabel(provider) }),
            );
          }
          const reading = this.#host
            .readUsage(client, defaultUsageModel(provider))
            .pipe(Effect.flatMap((usage) => this.#storeUsage(account, client, usage)));
          const limit =
            agentProviderDescriptor(provider).reportsUsage && !isKeyAccount(account)
              ? yield* reading.pipe(
                  Effect.catchIf(
                    (error) => afterSignIn || !isSignInError(error),
                    (error) =>
                      Effect.sync(() => {
                        logger.warn("A provider account usage reading failed.", {
                          provider,
                          afterSignIn,
                          message: this.#message(provider, error),
                        });
                        return null;
                      }),
                  ),
                )
              : null;
          this.#setState(account.id, { state: "connected", email, organization, message: ownApiKeyNotice(signedIn) });
          if (limit) this.#host.usageChanged(limit);
          const models = yield* this.#host.readModels(client);
          if (models && this.#states.has(account.id)) {
            this.#models.set(account.id, models);
            this.#host.changed();
            if (this.#host.modelsListed) yield* this.#host.modelsListed(provider, account.id);
          }
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
    if (homeSupport(account.provider)?.usageLeavesSession) return this.#usage.get(account.id)?.limit ?? null;
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
      this.#usageGate(account.id).succeeded();
      return limit;
    });
  }

  readonly signOutDefault = Effect.fn("ProviderAccounts.signOutDefault")(function* (
    this: ProviderAccounts,
    provider: AgentProviderId,
  ) {
    const command = ProviderAccounts.signOutCommand(provider);
    const cli = this.#host.cli(provider);
    if (!command || !cli)
      return yield* accountFailure(
        sourceText("error.provider.signOutUnsupported", { provider: providerLabel(provider) }),
      );
    yield* this.#runSignOut(provider, cli, command, {}).pipe(
      Effect.mapError((error) => accountFailure(this.#message(provider, error))),
    );
  });

  readonly #signOut = Effect.fn("ProviderAccounts.signOut")(function* (
    this: ProviderAccounts,
    account: StoredProviderAccount,
  ) {
    const command = homeSupport(account.provider)?.signOut;
    const cli = this.#host.cli(account.provider);
    if (!command || !cli || isKeyAccount(account)) return;
    yield* this.#runSignOut(account.provider, cli, command, this.environment(account)).pipe(
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
    provider: AgentProviderId,
    cli: AgentCliInfo,
    command: NonNullable<ProviderHomeAccountSupport["signOut"]>,
    environment: Readonly<Record<string, string>>,
  ): Effect.Effect<void, ProviderProcessFailed | ProviderSignInError> {
    const privateTemp = this.#host.signInTemp(provider);
    return Effect.scoped(
      Effect.gen(function* () {
        const env = { ...cliPathEnvironment(cli), ...command.env(cli), ...environment };
        if (command.acpLogout) {
          const logout = yield* startAcpAuthentication({
            executable: cli.executable,
            argv: command.argv,
            env,
            methodId: "",
            timeoutMs: command.timeoutMs,
            logoutOnly: true,
            signOutMethod: command.acpLogout === true ? undefined : command.acpLogout,
            privateTemp,
          });
          return yield* logout.done.pipe(
            Effect.mapError((error) => (error.cause instanceof ProviderSignInError ? error.cause : error)),
          );
        }
        const target = cliSpawnTarget(cli.executable, command.argv);
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(target.command, target.args, {
              cwd: process.cwd(),
              env: { ...process.env, ...env },
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
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof ProviderProcessFailed || cause instanceof ProviderSignInError
          ? cause
          : new ProviderProcessFailed({ cause }),
      ),
    );
  }

  #loginTaken(provider: AgentProviderId, accountId: string, login: AccountLogin): boolean {
    const same = (other: AccountLogin | null | undefined) =>
      other?.email?.toLowerCase() === login.email?.toLowerCase() && other?.organization === login.organization;
    if (same(this.#host.defaultLogin(provider))) return true;
    return this.#store.list(provider).some((other) => other.id !== accountId && same(this.#states.get(other.id)));
  }

  #interrupt(accountId: string): Effect.Effect<void> {
    const fibers = [this.#signIns.get(accountId), this.#checks.get(accountId)].filter((fiber) => fiber !== undefined);
    this.#signIns.delete(accountId);
    this.#checks.delete(accountId);
    return Fiber.interruptAll(fibers);
  }

  #forget(accountId: string): void {
    this.#states.delete(accountId);
    this.#codeResults.delete(accountId);
    this.#usage.delete(accountId);
    this.#usageGates.delete(accountId);
    this.#models.delete(accountId);
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
    if (patch.state && patch.state !== current?.state)
      logger.info("A provider account changed state.", { accountId, from: current?.state ?? null, to: patch.state });
    this.#states.set(accountId, {
      state: patch.state ?? current?.state ?? "checking",
      email: patch.email !== undefined ? patch.email : (current?.email ?? null),
      organization: patch.organization !== undefined ? patch.organization : (current?.organization ?? null),
      message: patch.message !== undefined ? patch.message : (current?.message ?? null),
      checkedAt: patch.state === "connected" || patch.state === "signed-out" ? Date.now() : (current?.checkedAt ?? 0),
    });
    this.#host.changed();
  }

  #message(provider: AgentProviderId, error: unknown): string {
    const cause = signInCause(error) ?? (error instanceof ProviderAccountFailed ? error.cause : error);
    const text = cause instanceof Error ? cause.message : String(cause);
    return shortenDiagnostic(this.#host.redact(text)) || providerLabel(provider);
  }
}

function isKeyAccount(account: StoredProviderAccount): boolean {
  return (
    (account.provider === "claude" && account.id === CLAUDE_API_KEY_ACCOUNT_ID) ||
    isKeyAccountSupport(ProviderAccounts.support(account.provider))
  );
}

function homeSupport(provider: AgentProviderId): ProviderHomeAccountSupport | undefined {
  const support = ProviderAccounts.support(provider);
  return isKeyAccountSupport(support) ? undefined : support;
}

function signedOutMessage(provider: AgentProviderId): string {
  return sourceText(
    isKeyAccountSupport(ProviderAccounts.support(provider))
      ? "error.provider.accountKeySignedOut"
      : "error.provider.accountSignedOut",
    { provider: providerLabel(provider) },
  );
}

function isSignInError(error: unknown): boolean {
  return signInCause(error) !== null;
}

function signInCause(error: unknown): ProviderSignInError | null {
  if (error instanceof ProviderSignInError) return error;
  return typeof error === "object" && error !== null && "cause" in error ? signInCause(error.cause) : null;
}

export function defaultUsageModel(provider: AgentProviderId): string | undefined {
  return provider === "codex" ? undefined : agentProviderDescriptor(provider).defaultModel || undefined;
}
