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
