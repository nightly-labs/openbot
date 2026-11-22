import {
  type CreditCheckoutRequest,
  type CreditsState,
  type CreditTransferRequest,
  parseCreditCheckoutUrl,
  parseCreditsState,
} from "@openbot/contracts/credits";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Layer } from "effect";
import {
  type AccountRequestClient,
  type AccountServiceFailure,
  AccountServicePlatform,
} from "./account-service-platform";

export class CreditsDesktopService {
  readonly #platform: Layer.Layer<AccountServicePlatform>;

  constructor(auth: AccountRequestClient, openExternal: (url: string) => Promise<void>) {
    this.#platform = AccountServicePlatform.layer(auth, openExternal);
  }

  getState(): Effect.Effect<CreditsState, AccountServiceFailure> {
    return readCreditsState().pipe(Effect.provide(this.#platform));
  }

  openCheckout(request: CreditCheckoutRequest): Effect.Effect<void, AccountServiceFailure> {
    return openCreditCheckout(request).pipe(Effect.provide(this.#platform));
  }

  transfer(request: CreditTransferRequest): Effect.Effect<CreditsState, AccountServiceFailure> {
    return transferCredits(request).pipe(Effect.provide(this.#platform));
  }
}

const readCreditsState = Effect.fn("CreditsDesktop.getState")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/credits/", { method: "GET" }, decodeCreditsState);
});

const openCreditCheckout = Effect.fn("CreditsDesktop.openCheckout")(function* (request: CreditCheckoutRequest) {
  const platform = yield* AccountServicePlatform;
  const url = yield* platform.request("/v1/me/credits/checkout", jsonPost(request), decodeCheckoutUrl);
  yield* platform.openPage(url);
});

const transferCredits = Effect.fn("CreditsDesktop.transfer")(function* (request: CreditTransferRequest) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/credits/transfer", jsonPost(request), decodeCreditsState);
});

function jsonPost(body: CreditCheckoutRequest | CreditTransferRequest): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function decodeCreditsState(value: unknown): CreditsState {
  const state = parseCreditsState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}

function decodeCheckoutUrl(value: unknown): string {
  const url = parseCreditCheckoutUrl(value);
  if (!url) throw new Error(sourceText("error.billing.notStripePage"));
  return url;
}
