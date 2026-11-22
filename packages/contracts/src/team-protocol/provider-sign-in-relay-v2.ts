import { adminRoute, count, fields, identifier, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY = "provider-sign-in-relay-v2";

export const PROVIDER_SIGN_IN_RELAY_V2_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider/v2/start",
} as const;

export const PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS = ["devin"] as const;

export const PROVIDER_SIGN_IN_RELAY_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_SIGN_IN_RELAY_V2_ROUTES.start,
    adminRoute(
      fields({ provider: oneOf(...PROVIDER_SIGN_IN_RELAY_V2_PROVIDERS) }),
      fields({ flowId: identifier, expiresAt: count }),
    ),
  ],
]);
