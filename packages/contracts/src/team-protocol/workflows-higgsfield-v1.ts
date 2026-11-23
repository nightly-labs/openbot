import { adminRoute, boolean, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_HIGGSFIELD_CAPABILITY = "workflows-higgsfield-v1";

export const WORKFLOWS_HIGGSFIELD_ROUTES = {
  providers: "/v1/workflows/media/higgsfield/providers",
  credits: "/v1/workflows/media/higgsfield/credits",
} as const;

export const WORKFLOWS_HIGGSFIELD_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_HIGGSFIELD_ROUTES.providers, adminRoute(empty, fields({ higgsfield: boolean }))],
  [
    WORKFLOWS_HIGGSFIELD_ROUTES.credits,
    adminRoute(empty, fields({ higgsfield: nullable(fields({ available: count, quota: nullable(count) })) })),
  ],
]);
