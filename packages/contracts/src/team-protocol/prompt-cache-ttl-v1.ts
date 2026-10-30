// Frozen optional prompt-cache-ttl-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set how long the host asks the provider to keep the prompt cache of that
// server's agents. `1h` asks for one hour; `5m` leaves the provider's own choice, which is five
// minutes with an API key. The host applies it to the providers that take a cache time, and to the
// provider processes that start after the change. A member cannot use either route; `requireAdmin`
// on the host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const PROMPT_CACHE_TTL_CAPABILITY = "prompt-cache-ttl-v1";

export const PROMPT_CACHE_TTL_ROUTES = {
  settings: "/v1/admin/host/prompt-cache-ttl",
  update: "/v1/admin/host/prompt-cache-ttl/update",
} as const;

const snapshot = fields({ ttl: oneOf("1h", "5m") });

export const PROMPT_CACHE_TTL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROMPT_CACHE_TTL_ROUTES.settings, adminRoute(empty, snapshot)],
  [PROMPT_CACHE_TTL_ROUTES.update, adminRoute(snapshot, snapshot)],
]);
