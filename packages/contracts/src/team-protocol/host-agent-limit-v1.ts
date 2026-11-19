import { adminRoute, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const HOST_AGENT_LIMIT_CAPABILITY = "host-agent-limit-v1";

export const HOST_AGENT_LIMIT_ROUTES = {
  settings: "/v1/admin/host/agent-limit",
  update: "/v1/admin/host/agent-limit/update",
} as const;

const snapshot = fields({ limit: nullable(count), defaultLimit: count, maxLimit: count });

export const HOST_AGENT_LIMIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_AGENT_LIMIT_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_AGENT_LIMIT_ROUTES.update, adminRoute(fields({ limit: nullable(count) }), snapshot)],
]);
