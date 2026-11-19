import { parseReferralState, type ReferralPageRequest, type ReferralState } from "@openbot/contracts/referral";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Layer } from "effect";
import {
  type AccountRequestClient,
  type AccountServiceFailure,
  AccountServicePlatform,
} from "./account-service-platform";

/**
 * Invite friends: the invite link of the account, the credit from friends, and one page of the friends
 * who joined. It is an account feature: the account server answers, not an OpenBot host.
 */
export class ReferralDesktopService {
  readonly #platform: Layer.Layer<AccountServicePlatform>;

  constructor(auth: AccountRequestClient, openExternal: (url: string) => Promise<void>) {
    this.#platform = AccountServicePlatform.layer(auth, openExternal);
  }

  getState(request: ReferralPageRequest): Effect.Effect<ReferralState, AccountServiceFailure> {
    return readReferralState(request).pipe(Effect.provide(this.#platform));
  }
}

const readReferralState = Effect.fn("ReferralDesktop.getState")(function* (request: ReferralPageRequest) {
  const platform = yield* AccountServicePlatform;
  return yield* platform.request(referralPath(request), { method: "GET" }, decodeReferralState);
});

function referralPath(request: ReferralPageRequest): string {
  const query = new URLSearchParams({ filter: request.filter, page: String(request.page) });
  return `/v1/me/referrals?${query.toString()}`;
}

function decodeReferralState(value: unknown): ReferralState {
  const state = parseReferralState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}
