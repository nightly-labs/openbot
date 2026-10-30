// Frozen optional provider-account-relay-v2 wire contract.
//
// `provider-account-relay-v1` for one more provider: Gemini (`antigravity`), which holds accounts after
// the first since v1 froze. Its `start` has the meaning of the v1 route, on a route of its own, and
// the released `sign-in-relay-v1` routes `status`, `complete` and `cancel` run the flow. A host
// advertises it only with `provider-account-relay-v1`, which stays for the clients that know only v1.
import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import {
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_PROVIDERS,
  PROVIDER_ACCOUNT_RELAY_ROUTES,
} from "./provider-account-relay-v1";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY = "provider-account-relay-v2";

export const PROVIDER_ACCOUNT_RELAY_V2_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account/v2/start",
} as const;

/** The providers whose account sign-in `start` relays: those of `sign-in-relay-v1` that hold accounts. */
export const PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS = ["codex", "claude", "antigravity"] as const;

export type ProviderAccountRelayProvider = (typeof PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS)[number];

export const PROVIDER_ACCOUNT_RELAY_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start,
    adminRoute(
      fields({ provider: oneOf(...PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS), accountId: nullable(PROVIDER_ACCOUNT_ID) }),
      fields({ flowId: identifier, expiresAt: count }),
    ),
  ],
]);

/** The account relay of a host: the route that starts an account's sign-in, and the providers it takes. */
export interface ProviderAccountRelay {
  start: string;
  providers: readonly ProviderAccountRelayProvider[];
}

/** The newest account relay that a host advertises, or null when it relays none. */
export function providerAccountRelay(
  supports: (
    capability: typeof PROVIDER_ACCOUNT_RELAY_CAPABILITY | typeof PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  ) => boolean,
): ProviderAccountRelay | null {
  if (supports(PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY))
    return { start: PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start, providers: PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS };
  if (supports(PROVIDER_ACCOUNT_RELAY_CAPABILITY))
    return { start: PROVIDER_ACCOUNT_RELAY_ROUTES.start, providers: PROVIDER_ACCOUNT_RELAY_PROVIDERS };
  return null;
}
