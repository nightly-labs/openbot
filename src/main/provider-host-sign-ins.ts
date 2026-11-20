import type { AgentProviderId, ProviderHostSignInStatus } from "@openbot/contracts/ipc";
import { PROVIDER_HOST_SIGN_IN_ERROR_LIMIT } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit, Option } from "effect";
import { providerLabel } from "../backend/agent/thread-items";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { HostSignInPages } from "./host-sign-in-pages";

export interface ProviderHostSignInDependencies {
  service: Pick<AgentService, "signInProviderOnHost" | "cancelProviderSignIn">;
  browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
}

export class ProviderHostSignIns {
  readonly #dependencies: ProviderHostSignInDependencies;
  readonly #pages: HostSignInPages<AgentProviderId, { error: string | null }>;

  constructor(dependencies: ProviderHostSignInDependencies) {
    this.#dependencies = dependencies;
    this.#pages = new HostSignInPages(dependencies.browser);
  }

  start(provider: AgentProviderId) {
    return this.#pages.start(
      provider,
      (openPage) => this.#dependencies.service.signInProviderOnHost(provider, openPage),
      (exit) => resultOf(provider, exit),
    );
  }

  startRelay(provider: AgentProviderId, atHost = false) {
    return this.#pages.start(
      provider,
      (openPage) => this.#dependencies.service.signInProviderOnHost(provider, openPage, atHost),
      (exit) => resultOf(provider, exit),
      "relay",
    );
  }

  relayStatus(provider: AgentProviderId): { pageUrl: string | null; result: { error: string | null } | null } {
    return { pageUrl: this.#pages.pageUrl(provider), result: this.status(provider).result };
  }

  status(provider: AgentProviderId): ProviderHostSignInStatus {
    return this.#pages.status(provider) ?? { tabId: null, result: { error: endedText(provider) } };
  }

  readonly cancel = Effect.fn("ProviderHostSignIns.cancel")(function* (
    this: ProviderHostSignIns,
    provider: AgentProviderId,
  ) {
    yield* this.#pages.interrupt(provider);
    yield* this.#dependencies.service.cancelProviderSignIn(provider);
  }).bind(this);

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
  return { error: failureText(provider, Option.isSome(failure) ? failure.value.cause : undefined) };
}

function failureText(provider: AgentProviderId, cause: unknown): string {
  return (cause instanceof Error ? cause.message : endedText(provider)).slice(0, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT);
}
