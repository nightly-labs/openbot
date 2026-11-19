import type { ProviderCodeLoginStart } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { classifyUserError } from "@openbot/user-errors";
import { Deferred, Effect, Result, Schema } from "effect";
import type { AgentClient } from "./../agent-client";
import { type CodexCliInfo, resolveCodexCli, resolveInstalledFirst } from "./../cli";
import { causeHelpers } from "../effect-boundary";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  CODEX_MODEL_PROVIDER_ACCOUNT_TYPE,
  decodeAccountDeviceCodeLoginStartResult,
  decodeAccountLoginStartResult,
  decodeCodexAccountReadResult,
  decodeRecordResponse,
  isCodexLoginType,
} from "./../protocol";
import { ProviderSignInError, signInReason } from "../provider-client-effects";
import { recordRestartActivity } from "../restart-activity";

const CODEX_LOGIN_TIMEOUT_MS = 10 * 60_000;
const UNVERIFIED_MESSAGE = "OpenBot could not verify the ChatGPT connection. Try again.";

interface PendingCodexLogin {
  client: AgentClient;
  cli: CodexCliInfo;
  loginId: string;
  timer: NodeJS.Timeout;
  completing: boolean;
  ended: Deferred.Deferred<boolean>;
}

export interface CodexLoginHost {
  bundledExecutable(): string | null | undefined;
  installedChosen(): boolean;
  createClient(cli: CodexCliInfo): AgentClient;
  hasActiveClient(client?: AgentClient): boolean;
  activate(
    client: AgentClient,
    cli: CodexCliInfo,
    account: NonNullable<AccountReadResult["account"]>,
    options?: { isCurrent?: () => boolean },
  ): Effect.Effect<void, CodexLoginFailed>;
  setConnecting(): void;
  isConnecting(): boolean;
  clearConnectionState(): void;
  setFailure(error: unknown, version?: string | null): void;
}

export class CodexLoginFlow {
  readonly #host: CodexLoginHost;
  #pending: PendingCodexLogin | null = null;

  constructor(host: CodexLoginHost) {
    this.#host = host;
  }

  get pending(): boolean {
    return this.#pending !== null;
  }

  dispose(): AgentClient | null {
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return null;
    clearTimeout(pending.timer);
    end(pending, false);
    return pending.client;
  }

  readonly startBrowser = Effect.fn("CodexLogin.startBrowser")(function* (
    this: CodexLoginFlow,
    openExternal: (url: string) => Promise<void>,
  ) {
    yield* this.#withLoginClientEffect((client, cli) =>
      Effect.gen({ self: this }, function* () {
        const login = yield* client
          .request(
            "account/login/start",
            {
              type: "chatgpt",
              appBrand: "chatgpt",
              codexStreamlinedLogin: true,
              useHostedLoginSuccessPage: true,
            },
            decodeAccountLoginStartResult,
          )
          .pipe(toCodexLoginFailed);
        this.#track(client, cli, login.loginId);
        const opened = yield* Effect.result(loginIo(() => openExternal(login.authUrl)));
        if (Result.isFailure(opened)) {
          yield* this.cancel("OpenBot could not open the ChatGPT connection page.");
          return yield* new CodexLoginFailed({ cause: new Error(sourceText("error.provider.chatgptPageFailed")) });
        }
      }),
    );
  }, Effect.uninterruptible).bind(this);

  readonly startDevice = Effect.fn("CodexLogin.startDevice")(function* (
    this: CodexLoginFlow,
  ): Effect.fn.Return<ProviderCodeLoginStart, CodexLoginFailed> {
    const started = yield* this.#withLoginClientEffect((client, cli) =>
      Effect.gen({ self: this }, function* () {
        const login = yield* client
          .request("account/login/start", { type: "chatgptDeviceCode" }, decodeAccountDeviceCodeLoginStartResult)
          .pipe(toCodexLoginFailed);
        this.#track(client, cli, login.loginId);
        const result: ProviderCodeLoginStart = {
          kind: "code",
          userCode: login.userCode,
          verificationUrl: login.verificationUrl,
          expiresAt: Date.now() + CODEX_LOGIN_TIMEOUT_MS,
        };
        return result;
      }),
    );
    return started ?? { kind: "connected" };
  }, Effect.uninterruptible).bind(this);

  readonly saveApiKey = Effect.fn("CodexLogin.saveApiKey")(function* (this: CodexLoginFlow, apiKey: string) {
    const bundledExecutable = this.#host.bundledExecutable();
    const cli = yield* resolveInstalledFirst(
      resolveCodexCli,
      bundledExecutable,
      true,
      this.#host.installedChosen(),
    ).pipe(toCodexLoginFailed);
    yield* Effect.acquireUseRelease(
      loginStep(() => this.#host.createClient(cli)),
      (client) =>
        Effect.gen(function* () {
          yield* initializeLoginClient(client);
          yield* client
            .request("account/login/start", { type: "apiKey", apiKey }, decodeRecordResponse)
            .pipe(toCodexLoginFailed);
          const { account } = yield* client
            .request("account/read", { refreshToken: false }, decodeCodexAccountReadResult)
            .pipe(toCodexLoginFailed);
          if (account?.type !== "apiKey") {
            return yield* new CodexLoginFailed({
              cause: new Error(
                account?.type === CODEX_MODEL_PROVIDER_ACCOUNT_TYPE
                  ? sourceText("error.provider.codexModelProvider")
                  : sourceText("error.provider.noAuthenticatedAccount", { provider: "ChatGPT" }),
              ),
            });
          }
        }),
      (client) => client.stop().pipe(toCodexLoginFailed).pipe(Effect.ignore),
    );
  }, Effect.uninterruptible).bind(this);

  readonly complete = Effect.fn("CodexLogin.complete")(function* (
    this: CodexLoginFlow,
    completion: AccountLoginCompletedResult,
    source: AgentClient,
  ) {
    const pending = this.#pending;
    if (!pending || pending.completing) return;
    if (pending.client !== source) return;
    if (completion.loginId !== null && completion.loginId !== pending.loginId) return;
    pending.completing = true;
    clearTimeout(pending.timer);

    if (!completion.success) {
      const reason = signInReason(completion.error);
      yield* this.#fail(
        pending,
        reason
          ? new ProviderSignInError({ message: sourceText("error.provider.acpSignInFailedReason", { reason }) })
          : "ChatGPT connection was not completed. Try again.",
      );
      return;
    }

    yield* Effect.gen({ self: this }, function* () {
      const account = yield* pending.client
        .request("account/read", { refreshToken: false }, decodeCodexAccountReadResult)
        .pipe(toCodexLoginFailed);
      if (account.account?.type === CODEX_MODEL_PROVIDER_ACCOUNT_TYPE) {
        return yield* this.#fail(
          pending,
          new ProviderSignInError({ message: sourceText("error.provider.codexModelProvider") }),
        );
      }
      if (account.account?.type !== "chatgpt") {
        return yield* new CodexLoginFailed({
          cause: new Error(sourceText("error.provider.noAuthenticatedAccount", { provider: "ChatGPT" })),
        });
      }
      if (this.#pending !== pending) return;
      const value = account.account;
      yield* this.#host
        .activate(pending.client, pending.cli, value, {
          isCurrent: () => this.#pending === pending,
        })
        .pipe(toCodexLoginFailed);
      if (this.#pending === pending) this.#pending = null;
      end(pending, true);
    }).pipe(Effect.catch(() => this.#fail(pending, UNVERIFIED_MESSAGE)));
  }, Effect.uninterruptible).bind(this);

  readonly failUnverified = Effect.fn("CodexLogin.failUnverified")(function* (this: CodexLoginFlow) {
    const pending = this.#pending;
    if (pending) yield* this.#fail(pending, UNVERIFIED_MESSAGE);
  }).bind(this);

  readonly cancel = Effect.fn("CodexLogin.cancel")(function* (
    this: CodexLoginFlow,
    message: string | null,
    expected?: PendingCodexLogin,
  ) {
    const pending = this.#pending;
    if (!pending || (expected && pending !== expected)) return;
    this.#pending = null;
    clearTimeout(pending.timer);
    end(pending, false);
    yield* pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .pipe(toCodexLoginFailed)
      .pipe(Effect.ignore);
    yield* pending.client.stop().pipe(toCodexLoginFailed).pipe(Effect.ignore);
    if (message) this.#host.setFailure(new Error(message), pending.cli.version);
    else this.#host.clearConnectionState();
  }, Effect.uninterruptible).bind(this);

  readonly settled = Effect.fn("CodexLogin.settled")(function* (this: CodexLoginFlow) {
    const pending = this.#pending;
    if (!pending) return null;
    return yield* Deferred.await(pending.ended);
  }).bind(this);

  readonly settleForRefresh = Effect.fn("CodexLogin.settleForRefresh")(function* (this: CodexLoginFlow) {
    const pending = this.#pending;
    if (!pending) {
      this.#host.clearConnectionState();
      return;
    }
    this.#pending = null;
    clearTimeout(pending.timer);
    const activated = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        const result = yield* pending.client
          .request("account/read", { refreshToken: false }, decodeCodexAccountReadResult)
          .pipe(toCodexLoginFailed);
        const account = result.account;
        if (account?.type !== "chatgpt") return false;
        yield* this.#host.activate(pending.client, pending.cli, account).pipe(toCodexLoginFailed);
        return true;
      }),
    );
    end(pending, Result.isSuccess(activated) && activated.success);
    if (Result.isSuccess(activated) && activated.success) return;
    yield* pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .pipe(toCodexLoginFailed)
      .pipe(Effect.ignore);
    yield* pending.client.stop().pipe(toCodexLoginFailed).pipe(Effect.ignore);
    this.#host.clearConnectionState();
  }, Effect.uninterruptible).bind(this);

  readonly #withLoginClientEffect = Effect.fn("CodexLogin.withClient")(function* <T>(
    this: CodexLoginFlow,
    run: (client: AgentClient, cli: CodexCliInfo) => Effect.Effect<T, CodexLoginFailed>,
  ) {
    let cli: CodexCliInfo | null = null;
    this.#host.setConnecting();
    return yield* Effect.gen({ self: this }, function* () {
      const bundledExecutable = this.#host.bundledExecutable();
      const resolved = yield* resolveInstalledFirst(
        resolveCodexCli,
        bundledExecutable,
        true,
        this.#host.installedChosen(),
      ).pipe(toCodexLoginFailed);
      cli = resolved;
      return yield* Effect.acquireUseRelease(
        loginStep(() => this.#host.createClient(resolved)),
        (client) =>
          Effect.gen({ self: this }, function* () {
            yield* initializeLoginClient(client);
            if (!this.#host.hasActiveClient()) {
              const existing = yield* client
                .request("account/read", { refreshToken: false }, decodeCodexAccountReadResult)
                .pipe(
                  toCodexLoginFailed,
                  Effect.catchIf(
                    (failure) => classifyUserError(failure.cause) === "auth",
                    () => Effect.succeed({ account: null }),
                  ),
                );
              const account = existing.account;
              if (account && isCodexLoginType(account.type)) {
                yield* this.#host.activate(client, resolved, account).pipe(toCodexLoginFailed);
                return null;
              }
            }
            return yield* run(client, resolved);
          }),
        (client) =>
          this.#pending?.client !== client && !this.#host.hasActiveClient(client)
            ? client.stop().pipe(toCodexLoginFailed).pipe(Effect.ignore)
            : Effect.void,
      );
    }).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (!this.#pending && this.#host.isConnecting()) this.#host.setFailure(failure.cause, cli?.version);
        }),
      ),
    );
  }, Effect.uninterruptible);

  #track(client: AgentClient, cli: CodexCliInfo, loginId: string): PendingCodexLogin {
    let pending: PendingCodexLogin;
    const timer = setTimeout(() => {
      Effect.runFork(this.cancel("ChatGPT connection timed out. Try again.", pending));
    }, CODEX_LOGIN_TIMEOUT_MS);
    timer.unref?.();
    pending = { client, cli, loginId, timer, completing: false, ended: Deferred.makeUnsafe<boolean>() };
    this.#pending = pending;
    recordRestartActivity();
    client.once("exit", () => {
      if (this.#pending?.client === client) {
        Effect.runFork(this.#fail(this.#pending, "ChatGPT connection stopped. Try again."));
      }
    });
    return pending;
  }

  readonly #fail = Effect.fn("CodexLogin.fail")(function* (
    this: CodexLoginFlow,
    pending: PendingCodexLogin,
    failure: string | ProviderSignInError,
  ) {
    if (this.#pending !== pending) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    end(pending, false);
    yield* pending.client.stop().pipe(toCodexLoginFailed).pipe(Effect.ignore);
    this.#host.setFailure(typeof failure === "string" ? new Error(failure) : failure, pending.cli.version);
  }, Effect.uninterruptible);
}

function initializeLoginClient(client: AgentClient): Effect.Effect<void, CodexLoginFailed> {
  return Effect.gen(function* () {
    yield* loginStep(() => client.start());
    yield* client
      .request(
        "initialize",
        {
          clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
          capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
        },
        decodeRecordResponse,
      )
      .pipe(toCodexLoginFailed);
    yield* loginStep(() => client.notify("initialized"));
  });
}

function end(pending: PendingCodexLogin, signedIn: boolean): void {
  Deferred.doneUnsafe(pending.ended, Effect.succeed(signedIn));
}

export class CodexLoginFailed extends Schema.TaggedError<CodexLoginFailed>()("CodexLoginFailed", {
  cause: Schema.Defect(),
}) {}

const { io: loginIo, sync: loginStep, rewrap: toCodexLoginFailed } = causeHelpers(CodexLoginFailed);

export { toCodexLoginFailed };
