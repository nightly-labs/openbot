// Frozen optional provider-account-pool-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change the account pool of each of the host's providers. With the pool on, the
// host moves each agent of the provider to one account of the pool before the agent's next work: the
// account whose longest usage window resets first, while each window keeps a buffer below its limit.
// The host uses one account until it nears a limit, then the next one. An account that is left out of
// the pool is not used by the pool; an agent can still use it with the pool off.
//
// `list` gives only the providers whose pool is on: the accounts left out, and the account that the
// pool uses now, or `null` before the pool picked one. `update` turns the pool of one provider on or
// off and sets the accounts left out; the host ignores an account it does not know. No credential,
// usage reading or agent travels on these routes. A member cannot use them; `requireAdmin` on the
// host is the only gate, as on `provider-accounts-v1`.
//
// A provider is an open bounded string: the host refuses one that cannot hold accounts, and a client
// ignores one that it does not know. Widening any of it needs a second capability string.
import { adminRoute, boolean, empty, fields, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_POOL_CAPABILITY = "provider-account-pool-v1";

export const PROVIDER_ACCOUNT_POOL_ROUTES = {
  list: "/v1/admin/providers/accounts/pool",
  update: "/v1/admin/providers/accounts/pool/update",
} as const;

const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
const provider = string(PROVIDER_LIMIT);
const leftOut = list(PROVIDER_ACCOUNT_ID, ACCOUNTS_PER_PROVIDER);

export const PROVIDER_ACCOUNT_POOL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_POOL_ROUTES.list,
    adminRoute(
      empty,
      fields({
        pools: list(fields({ provider, leftOut, inUse: nullable(PROVIDER_ACCOUNT_ID) }), PROVIDER_LIMIT),
      }),
    ),
  ],
  [PROVIDER_ACCOUNT_POOL_ROUTES.update, adminRoute(fields({ provider, enabled: boolean, leftOut }), empty)],
]);
