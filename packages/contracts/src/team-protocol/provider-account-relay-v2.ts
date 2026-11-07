// Frozen optional provider-account-relay-v2 wire contract.
//
// `provider-account-relay-v1` for one more provider: Gemini (`antigravity`), which holds accounts after
// the first since v1 froze. Its `start` has the meaning of the v1 route, on a route of its own, and
// the released `sign-in-relay-v1` routes `status`, `complete` and `cancel` run the flow. A host
// advertises it only with `provider-account-relay-v1`, which stays for the clients that know only v1.
import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY = "provider-account-relay-v2";

export const PROVIDER_ACCOUNT_RELAY_V2_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account/v2/start",
} as const;

/** The providers whose account sign-in `start` relays: those of `sign-in-relay-v1` that hold accounts. */
export const PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS = ["codex", "claude", "antigravity"] as const;

export const PROVIDER_ACCOUNT_RELAY_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start,
    adminRoute(
      fields({ provider: oneOf(...PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS), accountId: nullable(PROVIDER_ACCOUNT_ID) }),
      fields({ flowId: identifier, expiresAt: count }),
    ),
  ],
]);
