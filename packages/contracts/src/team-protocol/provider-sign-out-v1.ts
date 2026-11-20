import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const PROVIDER_SIGN_OUT_CAPABILITY = "provider-sign-out-v1";

export const PROVIDER_SIGN_OUT_ROUTES = {
  signOut: "/v1/admin/providers/sign-out",
} as const;

const PROVIDER_LIMIT = 64;

export const PROVIDER_SIGN_OUT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_SIGN_OUT_ROUTES.signOut, adminRoute(fields({ provider: string(PROVIDER_LIMIT) }), empty)],
]);
