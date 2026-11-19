import {
  type BillingPortalRequest,
  type BillingState,
  type BillingStorageRequest,
  parseBillingSessionUrl,
  parseBillingState,
} from "@openbot/contracts/billing";
import {
  type BillingDetails,
  type BillingDetailsRequest,
  parseBillingDetails,
} from "@openbot/contracts/billing-details";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Layer } from "effect";
import {
  type AccountRequestClient,
  type AccountServiceFailure,
  AccountServicePlatform,
} from "./account-service-platform";

export type BillingAuthClient = AccountRequestClient;

/**
 * The Stripe plan of each server that the account pays for. The renderer never sends a URL: this
 * service gets the Customer Portal URL from the account server and opens it only when it is an https
 * Stripe page.
 */
export class BillingDesktopService {
  readonly #platform: Layer.Layer<AccountServicePlatform>;

  constructor(auth: BillingAuthClient, openExternal: (url: string) => Promise<void>) {
    this.#platform = AccountServicePlatform.layer(auth, openExternal);
  }

  getState(): Effect.Effect<BillingState, AccountServiceFailure> {
    return readBillingState().pipe(Effect.provide(this.#platform));
  }

  openPortal(request: BillingPortalRequest): Effect.Effect<void, AccountServiceFailure> {
    return openBillingPortal(request).pipe(Effect.provide(this.#platform));
  }

  /** Buys a larger storage tier for one server. The account server charges the saved payment method. */
  buyStorage(request: BillingStorageRequest): Effect.Effect<BillingState, AccountServiceFailure> {
    return buyBillingStorage(request).pipe(Effect.provide(this.#platform));
  }

  /** The billing country and EU VAT ID of the account. */
  getDetails(): Effect.Effect<BillingDetails, AccountServiceFailure> {
    return readBillingDetails().pipe(Effect.provide(this.#platform));
  }

  /** Saves the billing country and EU VAT ID. The account server checks a VAT ID with the EU VIES. */
  setDetails(request: BillingDetailsRequest): Effect.Effect<BillingDetails, AccountServiceFailure> {
    return saveBillingDetails(request).pipe(Effect.provide(this.#platform));
  }
}

const readBillingState = Effect.fn("BillingDesktop.getState")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/billing/", { method: "GET" }, decodeBillingState);
});

const openBillingPortal = Effect.fn("BillingDesktop.openPortal")(function* (request: BillingPortalRequest) {
  const platform = yield* AccountServicePlatform;
  const url = yield* platform.request(
    "/v1/me/billing/portal",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    decodeSessionUrl,
  );
  yield* platform.openPage(url);
});

const buyBillingStorage = Effect.fn("BillingDesktop.buyStorage")(function* (request: BillingStorageRequest) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request(
    "/v1/me/billing/storage",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    decodeBillingState,
  );
});

const readBillingDetails = Effect.fn("BillingDesktop.getDetails")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/billing/details", { method: "GET" }, decodeBillingDetails);
});

const saveBillingDetails = Effect.fn("BillingDesktop.setDetails")(function* (request: BillingDetailsRequest) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request(
    "/v1/me/billing/details",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
    decodeBillingDetails,
  );
});

function decodeBillingDetails(value: unknown): BillingDetails {
  const details = parseBillingDetails(value);
  if (!details) throw new Error(sourceText("error.billing.invalidResponse"));
  return details;
}

function decodeBillingState(value: unknown): BillingState {
  const state = parseBillingState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}

function decodeSessionUrl(value: unknown): string {
  const url = parseBillingSessionUrl(value);
  if (!url) throw new Error(sourceText("error.billing.notStripePage"));
  return url;
}
