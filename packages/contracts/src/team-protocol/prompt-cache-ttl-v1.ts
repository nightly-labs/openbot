import { adminRoute, empty, fields, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const PROMPT_CACHE_TTL_CAPABILITY = "prompt-cache-ttl-v1";
export const PROMPT_CACHE_TTL_PI_CAPABILITY = "prompt-cache-ttl-pi-v1";

export const PROMPT_CACHE_TTL_ROUTES = {
  settings: "/v1/admin/host/prompt-cache-ttl",
  update: "/v1/admin/host/prompt-cache-ttl/update",
} as const;

const snapshot = fields({ ttl: oneOf("1h", "5m") });

export const PROMPT_CACHE_TTL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROMPT_CACHE_TTL_ROUTES.settings, adminRoute(empty, snapshot)],
  [PROMPT_CACHE_TTL_ROUTES.update, adminRoute(snapshot, snapshot)],
]);
