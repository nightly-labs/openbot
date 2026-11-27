import { type CreditMediaCatalog, parseCreditMediaCatalog } from "@openbot/contracts/credit-media";
import {
  type CreditActivity,
  type CreditCheckoutRequest,
  type CreditRedeemRequest,
  type CreditRedeemResult,
  type CreditsState,
  type CreditTransferRequest,
  parseCreditActivity,
  parseCreditCheckoutUrl,
  parseCreditRedeemResult,
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

  getActivity(): Effect.Effect<CreditActivity, AccountServiceFailure> {
    return readCreditActivity().pipe(Effect.provide(this.#platform));
  }

  getCatalog(): Effect.Effect<CreditMediaCatalog, AccountServiceFailure> {
    return readCreditCatalog().pipe(Effect.provide(this.#platform));
  }

  openCheckout(request: CreditCheckoutRequest): Effect.Effect<void, AccountServiceFailure> {
    return openCreditCheckout(request).pipe(Effect.provide(this.#platform));
  }

  transfer(request: CreditTransferRequest): Effect.Effect<CreditsState, AccountServiceFailure> {
    return transferCredits(request).pipe(Effect.provide(this.#platform));
  }

  redeem(request: CreditRedeemRequest): Effect.Effect<CreditRedeemResult, AccountServiceFailure> {
    return redeemCreditCode(request).pipe(Effect.provide(this.#platform));
  }
}

const readCreditsState = Effect.fn("CreditsDesktop.getState")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/credits/", { method: "GET" }, decodeCreditsState);
});

const readCreditActivity = Effect.fn("CreditsDesktop.getActivity")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/credits/activity", { method: "GET" }, decodeCreditActivity);
});

const readCreditCatalog = Effect.fn("CreditsDesktop.getCatalog")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/media/models", { method: "GET" }, decodeCreditCatalog);
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

const redeemCreditCode = Effect.fn("CreditsDesktop.redeem")(function* (request: CreditRedeemRequest) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/credits/redeem", jsonPost(request), decodeCreditRedeemResult);
});

function jsonPost(body: CreditCheckoutRequest | CreditTransferRequest | CreditRedeemRequest): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function decodeCreditsState(value: unknown): CreditsState {
  const state = parseCreditsState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}

function decodeCreditRedeemResult(value: unknown): CreditRedeemResult {
  const result = parseCreditRedeemResult(value);
  if (!result) throw new Error(sourceText("error.billing.invalidResponse"));
  return result;
}

function decodeCreditActivity(value: unknown): CreditActivity {
  const activity = parseCreditActivity(value);
  if (!activity) throw new Error(sourceText("error.billing.invalidResponse"));
  return activity;
}

function decodeCreditCatalog(value: unknown): CreditMediaCatalog {
  const catalog = parseCreditMediaCatalog(value);
  if (!catalog) throw new Error(sourceText("error.billing.invalidResponse"));
  return catalog;
}

function decodeCheckoutUrl(value: unknown): string {
  const url = parseCreditCheckoutUrl(value);
  if (!url) throw new Error(sourceText("error.billing.notStripePage"));
  return url;
}
