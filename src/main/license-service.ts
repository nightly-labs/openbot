import {
  type LicenseCheckoutRequest,
  type LicensePlanRequest,
  type LicenseRenewalRequest,
  type LicenseState,
  type LicenseUsersRequest,
  parseLicenseCheckoutUrl,
  parseLicenseState,
} from "@openbot/contracts/license";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Layer } from "effect";
import {
  type AccountRequestClient,
  type AccountServiceFailure,
  AccountServicePlatform,
} from "./account-service-platform";

/**
 * The commercial license of the account. The renderer never sends a URL: this service gets the Stripe
 * Checkout URL from the account server and opens it only when it is an https Stripe page.
 */
export class LicenseDesktopService {
  readonly #platform: Layer.Layer<AccountServicePlatform>;

  constructor(auth: AccountRequestClient, openExternal: (url: string) => Promise<void>) {
    this.#platform = AccountServicePlatform.layer(auth, openExternal);
  }

  getState(): Effect.Effect<LicenseState, AccountServiceFailure> {
    return readLicenseState().pipe(Effect.provide(this.#platform));
  }

  openCheckout(request: LicenseCheckoutRequest): Effect.Effect<void, AccountServiceFailure> {
    return openLicenseCheckout(request).pipe(Effect.provide(this.#platform));
  }

  setUsers(request: LicenseUsersRequest): Effect.Effect<LicenseState, AccountServiceFailure> {
    return postLicense("/v1/me/license/users", request).pipe(Effect.provide(this.#platform));
  }

  changePlan(request: LicensePlanRequest): Effect.Effect<LicenseState, AccountServiceFailure> {
    return postLicense("/v1/me/license/plan", request).pipe(Effect.provide(this.#platform));
  }

  setRenewal(request: LicenseRenewalRequest): Effect.Effect<LicenseState, AccountServiceFailure> {
    return postLicense("/v1/me/license/renewal", request).pipe(Effect.provide(this.#platform));
  }
}

const readLicenseState = Effect.fn("LicenseDesktop.getState")(function* () {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request("/v1/me/license/", { method: "GET" }, decodeLicenseState);
});

const openLicenseCheckout = Effect.fn("LicenseDesktop.openCheckout")(function* (request: LicenseCheckoutRequest) {
  const platform = yield* AccountServicePlatform;
  const url = yield* platform.request("/v1/me/license/checkout", jsonPost(request), decodeCheckoutUrl);
  yield* platform.openPage(url);
});

const postLicense = Effect.fn("LicenseDesktop.post")(function* (
  path: string,
  request: LicenseUsersRequest | LicensePlanRequest | LicenseRenewalRequest,
) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request(path, jsonPost(request), decodeLicenseState);
});

function jsonPost(
  body: LicenseCheckoutRequest | LicenseUsersRequest | LicensePlanRequest | LicenseRenewalRequest,
): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function decodeLicenseState(value: unknown): LicenseState {
  const state = parseLicenseState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}

function decodeCheckoutUrl(value: unknown): string {
  const url = parseLicenseCheckoutUrl(value);
  if (!url) throw new Error(sourceText("error.billing.notStripePage"));
  return url;
}
