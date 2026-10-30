// Frozen optional provider-usage-reset-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// joined server can read the usage reset credits of the host's provider accounts, and spend one.
// Codex gives these credits: one restores the spent usage limits of its account at once. A member
// cannot use any route; `requireAdmin` on the host is the only gate.
//
// `list` reads the usage of each connected account of `provider` and answers the credits that each
// one has (`available`), the provider's own sign-in as `default`. An account of a provider with no
// credits is left out. `consume` spends one credit of one account and answers what the provider did:
// `reset`, `nothingToReset` (no limit was spent, no credit used), `noCredit` (none left) or
// `alreadyRedeemed`. The host refuses an account it does not hold, and a provider that it cannot reset.
// A reset ends the usage limit that holds the account's agents on the host.
//
// A provider is an open bounded string: the host refuses one it does not know, and a client ignores
// one it does not know. No credential travels on these routes.
import {
  type AdminDecoder,
  adminRoute,
  count,
  fields,
  list,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const PROVIDER_USAGE_RESET_CAPABILITY = "provider-usage-reset-v1";

export const PROVIDER_USAGE_RESET_ROUTES = {
  list: "/v1/admin/providers/usage-reset/list",
  consume: "/v1/admin/providers/usage-reset/consume",
} as const;

const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const accountId: AdminDecoder = (value) => {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new Error("Invalid provider account.");
  return value;
};
const provider = string(PROVIDER_LIMIT);

export const PROVIDER_USAGE_RESET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_USAGE_RESET_ROUTES.list,
    adminRoute(
      fields({ provider }),
      fields({ accounts: list(fields({ provider, accountId, available: count }), ACCOUNTS_PER_PROVIDER) }),
    ),
  ],
  [
    PROVIDER_USAGE_RESET_ROUTES.consume,
    adminRoute(
      fields({ provider, accountId }),
      fields({ outcome: oneOf("reset", "nothingToReset", "noCredit", "alreadyRedeemed") }),
    ),
  ],
]);
