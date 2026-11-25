import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const PROVIDER_HOST_SIGN_IN_CAPABILITY = "provider-host-sign-in-v1";

export const PROVIDER_HOST_SIGN_IN_ROUTES = {
  start: "/v1/admin/providers/host-sign-in/start",
  status: "/v1/admin/providers/host-sign-in/status",
  cancel: "/v1/admin/providers/host-sign-in/cancel",
} as const;

export const PROVIDER_HOST_SIGN_IN_ERROR_LIMIT = 2_000;

export const PROVIDER_HOST_SIGN_IN_PROVIDERS = ["antigravity"] as const;

const byProvider = fields({ provider: oneOf(...PROVIDER_HOST_SIGN_IN_PROVIDERS) });

export const PROVIDER_HOST_SIGN_IN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_HOST_SIGN_IN_ROUTES.start, adminRoute(byProvider, empty)],
  [
    PROVIDER_HOST_SIGN_IN_ROUTES.status,
    adminRoute(
      byProvider,
      fields({
        tabId: nullable(string(128)),
        result: nullable(fields({ error: nullable(string(PROVIDER_HOST_SIGN_IN_ERROR_LIMIT)) })),
      }),
    ),
  ],
  [PROVIDER_HOST_SIGN_IN_ROUTES.cancel, adminRoute(byProvider, empty)],
]);
