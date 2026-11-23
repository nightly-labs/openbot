import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_CAPABILITY = "provider-account-relay-v1";

export const PROVIDER_ACCOUNT_RELAY_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account/start",
} as const;

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
