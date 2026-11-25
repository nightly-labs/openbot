import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY = "provider-account-relay-v2";

export const PROVIDER_ACCOUNT_RELAY_V2_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account/v2/start",
} as const;

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
