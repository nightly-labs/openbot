import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type ProviderAccountPoolStrategy,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { PROVIDER_ACCOUNT_MODELS_LIMIT } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNTS_MESSAGE_LIMIT } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit, Option, Semaphore } from "effect";
import { providerLabel } from "../backend/agent/thread-items";
import { AgentLifecycleFailed, type AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { type HostSignInPageMode, HostSignInPages } from "./host-sign-in-pages";

export interface ProviderAccountsHostDependencies {
  service: Pick<
    AgentService,
    | "getStatus"
    | "getProviderAccountUsage"
    | "listAgents"
    | "updateAgent"
    | "signInProviderAccountOnHost"
    | "connectProviderAccountKey"
    | "startProviderAccountCodeLogin"
    | "submitProviderAccountCodeLogin"
    | "providerAccountCodeLoginStatus"
    | "cancelProviderAccountSignIn"
    | "renameProviderAccount"
    | "removeProviderAccount"
    | "setProviderAccountPool"
    | "setLiveVoiceAccount"
    | "liveVoiceAccount"
  >;
  browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
}

export class ProviderAccountsHost {
  readonly #dependencies: ProviderAccountsHostDependencies;
  readonly #pages: HostSignInPages<AgentProviderId, { error: string | null }>;
  readonly #starting = Semaphore.makeUnsafe(1);

  constructor(dependencies: ProviderAccountsHostDependencies) {
    this.#dependencies = dependencies;
    this.#pages = new HostSignInPages(dependencies.browser);
  }

  list() {
    const providers = (this.#dependencies.service.getStatus().providers ?? []).flatMap((row) =>
      row.accounts
        ? [
            {
              provider: row.id,
              accounts: row.accounts.map(({ models: _models, ...account }) => ({
                ...account,
                message: account.message?.slice(0, PROVIDER_ACCOUNTS_MESSAGE_LIMIT) ?? null,
              })),
            },
          ]
        : [],
    );
    const agents = this.#dependencies.service
      .listAgents()
      .flatMap((agent) =>
        agent.providerAccountId && agent.providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID
          ? [{ agentId: agent.id, accountId: agent.providerAccountId }]
          : [],
      );
    return { providers, agents };
  }

  models() {
    const providers = (this.#dependencies.service.getStatus().providers ?? []).flatMap((row) => {
      const accounts = (row.accounts ?? []).flatMap((account) =>
        account.models?.length
          ? [
              {
                accountId: account.id,
                models: account.models
                  .slice(0, PROVIDER_ACCOUNT_MODELS_LIMIT)
                  .map(({ provider: _provider, listing: _listing, ...model }) => model),
              },
            ]
          : [],
      );
      return accounts.length ? [{ provider: row.id, accounts }] : [];
    });
    return { providers };
  }

  pools() {
    const pools = (this.#dependencies.service.getStatus().providers ?? []).flatMap((row) =>
      row.accounts && row.accountPool ? [{ provider: row.id, ...row.accountPool }] : [],
    );
    return { pools };
  }

  setPool(provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) {
    return this.#dependencies.service.setProviderAccountPool(provider, enabled, leftOut).pipe(Effect.asVoid);
  }

  poolStrategies() {
    const strategies = (this.#dependencies.service.getStatus().providers ?? []).flatMap((row) =>
      row.accounts && row.accountPool ? [{ provider: row.id, strategy: row.accountPool.strategy ?? "fillFirst" }] : [],
    );
    return { strategies };
  }

  setPoolStrategy(provider: AgentProviderId, strategy: ProviderAccountPoolStrategy) {
    const pool = this.#dependencies.service.getStatus().providers?.find((row) => row.id === provider)?.accountPool;
    if (!pool) return Effect.void;
    return this.#dependencies.service
      .setProviderAccountPool(provider, true, pool.leftOut, strategy)
      .pipe(Effect.asVoid);
  }

  liveVoiceAccount() {
    return { accountId: this.#dependencies.service.liveVoiceAccount() };
  }

  setLiveVoiceAccount(accountId: string | null) {
    return this.#dependencies.service.setLiveVoiceAccount(accountId).pipe(Effect.asVoid);
  }

  readonly usage = Effect.fn("ProviderAccountsHost.usage")(function* (this: ProviderAccountsHost) {
    return yield* this.#dependencies.service.getProviderAccountUsage();
  }).bind(this);

  startSignIn(provider: AgentProviderId, accountId: string | null, mode: HostSignInPageMode = "tab", atHost = false) {
    return this.#pages.interrupt(provider).pipe(
      Effect.andThen(
        this.#pages.start(
          provider,
          (openPage) => this.#dependencies.service.signInProviderAccountOnHost(provider, accountId, openPage, atHost),
          (exit) => resultOf(provider, exit),
          mode,
        ),
      ),
      (start) => this.#starting.withPermit(start),
    );
  }

  startRelay(provider: AgentProviderId, accountId: string | null, atHost = false) {
    return this.startSignIn(provider, accountId, "relay", atHost);
  }

  relayStatus(provider: AgentProviderId): { pageUrl: string | null; result: { error: string | null } | null } {
    return { pageUrl: this.#pages.pageUrl(provider), result: this.signInStatus(provider).result };
  }

  signInStatus(provider: AgentProviderId) {
    return this.#pages.status(provider) ?? { tabId: null, result: { error: endedText(provider) } };
  }

  connectKey(provider: AgentProviderId, accountId: string | null, key: string) {
    return this.#dependencies.service.connectProviderAccountKey(provider, accountId, key).pipe(Effect.asVoid);
  }

  startCodeSignIn(provider: AgentProviderId, accountId: string | null) {
    return this.#dependencies.service.startProviderAccountCodeLogin(provider, accountId);
  }

  submitCodeSignIn(provider: AgentProviderId, accountId: string, code: string): void {
    this.#dependencies.service.submitProviderAccountCodeLogin(provider, accountId, code);
  }

  codeSignInStatus(provider: AgentProviderId, accountId: string) {
    const { result } = this.#dependencies.service.providerAccountCodeLoginStatus(provider, accountId);
    return { result: result && { error: result.error?.slice(0, PROVIDER_ACCOUNTS_MESSAGE_LIMIT) ?? null } };
  }

  cancelCodeSignIn(provider: AgentProviderId, accountId: string) {
    return this.#dependencies.service.cancelProviderAccountSignIn(provider, accountId).pipe(Effect.asVoid);
  }

  cancelSignIn(provider: AgentProviderId) {
    return this.#pages.interrupt(provider);
  }

  rename(provider: AgentProviderId, accountId: string, label: string | null) {
    return this.#dependencies.service.renameProviderAccount(provider, accountId, label).pipe(Effect.asVoid);
  }

  remove(provider: AgentProviderId, accountId: string) {
    if (provider === "claude" && accountId === CLAUDE_API_KEY_ACCOUNT_ID)
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "removeProviderAccount",
          cause: new Error(sourceText("error.provider.accountUsesKey", { provider: providerLabel(provider) })),
        }),
      );
    return this.#dependencies.service.removeProviderAccount(provider, accountId).pipe(Effect.asVoid);
  }

  setAgentAccount(agentId: string, accountId: string | null) {
    return this.#dependencies.service
      .updateAgent({ agentId, providerAccountId: accountId }, undefined, false)
      .pipe(Effect.asVoid);
  }

  close() {
    return this.#pages.close();
  }
}

function endedText(provider: AgentProviderId): string {
  return sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) });
}

function resultOf(provider: AgentProviderId, exit: Exit.Exit<void, { cause: unknown }>): { error: string | null } {
  if (Exit.isSuccess(exit)) return { error: null };
  const failure = Cause.findErrorOption(exit.cause);
  const cause = Option.isSome(failure) ? failure.value.cause : undefined;
  return {
    error: (cause instanceof Error ? cause.message : endedText(provider)).slice(0, PROVIDER_ACCOUNTS_MESSAGE_LIMIT),
  };
}
