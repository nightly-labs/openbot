// Frozen optional provider-account-relay-v1 wire contract.
//
// An owner or admin of a joined server signs in an account of a host provider after the first from
// their own computer, as `sign-in-relay-v1` signs in the provider's own sign-in. `start` signs in a new
// account when `accountId` is null, or a signed-out one again. It starts the account's sign-in on the
// host with no tab, and returns a flow at once. The released `sign-in-relay-v1` routes `status`,
// `complete` and `cancel` then run the flow; this capability adds no other route.
//
// A host advertises it only with `sign-in-relay-v1` and `provider-accounts-v1`. The account sign-in is
// the one of `provider-accounts-v1`: one runs for each provider, a new start replaces the one that
// runs, and a new account that did not sign in goes with it. A member cannot use the route;
// `requireAdmin` on the host is the only gate.
import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_CAPABILITY = "provider-account-relay-v1";

export const PROVIDER_ACCOUNT_RELAY_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account/start",
} as const;

/** The providers whose account sign-in `start` relays: those of `sign-in-relay-v1` that hold accounts. */
export const PROVIDER_ACCOUNT_RELAY_PROVIDERS = ["codex", "claude"] as const;

export const PROVIDER_ACCOUNT_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_RELAY_ROUTES.start,
    adminRoute(
      fields({ provider: oneOf(...PROVIDER_ACCOUNT_RELAY_PROVIDERS), accountId: nullable(PROVIDER_ACCOUNT_ID) }),
      fields({ flowId: identifier, expiresAt: count }),
    ),
  ],
]);
