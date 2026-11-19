import { adminRoute, boolean, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_SUNRA_CAPABILITY = "workflows-sunra-v1";

export const WORKFLOWS_SUNRA_ROUTES = {
  providers: "/v1/workflows/media/providers",
  credits: "/v1/workflows/media/credits",
} as const;

export const WORKFLOWS_SUNRA_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_SUNRA_ROUTES.providers, adminRoute(empty, fields({ sunra: boolean }))],
  [
    WORKFLOWS_SUNRA_ROUTES.credits,
    adminRoute(empty, fields({ sunra: nullable(fields({ available: count, quota: nullable(count) })) })),
  ],
]);
