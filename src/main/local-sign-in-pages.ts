import { browserAddressPasteSupported } from "@openbot/contracts/agent-providers";
import { type AgentProviderId, loopbackCallback, relayCallbackQuery } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { replaySignInCallback } from "./sign-in-relay-host";

class LocalSignInPasteRefused extends Schema.TaggedError<LocalSignInPasteRefused>()("LocalSignInPasteRefused", {
  cause: Schema.Defect(),
}) {}

const refuse = (key: "error.mcp.relayEnded" | "error.mcp.relayAddressInvalid") =>
  Effect.fail(new LocalSignInPasteRefused({ cause: new Error(sourceText(key)) }));

export class LocalSignInPages {
  readonly #pages = new Map<AgentProviderId, string>();
  readonly #signingIn: (provider: AgentProviderId) => boolean;
  readonly #platform: string;

  constructor(signingIn: (provider: AgentProviderId) => boolean, platform: string = process.platform) {
    this.#signingIn = signingIn;
    this.#platform = platform;
  }

  opened(provider: AgentProviderId, url: string): void {
    this.#pages.delete(provider);
    if (!browserAddressPasteSupported(provider, this.#platform) || !loopbackCallback(url)) return;
    if (new URL(url).searchParams.get("state")) this.#pages.set(provider, url);
  }

  forget(provider: AgentProviderId): void {
    this.#pages.delete(provider);
  }

  paste(provider: AgentProviderId, address: string) {
    return this.#paste(provider, address);
  }

  readonly #paste = Effect.fn("LocalSignInPages.paste")(function* (
    this: LocalSignInPages,
    provider: AgentProviderId,
    address: string,
  ) {
    const page = this.#pages.get(provider);
    if (!page || !this.#signingIn(provider)) {
      this.#pages.delete(provider);
      return yield* refuse("error.mcp.relayEnded");
    }
    const query = relayCallbackQuery(address, new URL(page).searchParams.get("state"));
    if (query === null) return yield* refuse("error.mcp.relayAddressInvalid");
    if (!(yield* replaySignInCallback(new URLSearchParams(query), page))) return yield* refuse("error.mcp.relayEnded");
    this.#pages.delete(provider);
  });
}
