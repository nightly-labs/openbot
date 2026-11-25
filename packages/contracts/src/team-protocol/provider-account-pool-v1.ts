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
