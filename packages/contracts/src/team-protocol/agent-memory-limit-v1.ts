import { adminRoute, count, empty, fields, list, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_MEMORY_LIMIT_CAPABILITY = "agent-memory-limit-v1";

export const AGENT_MEMORY_LIMIT_ROUTES = {
  settings: "/v1/admin/host/agent-memory-limit",
  update: "/v1/admin/host/agent-memory-limit/update",
} as const;

const snapshot = fields({ limit: count, choices: list(count, 16) });

export const AGENT_MEMORY_LIMIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_MEMORY_LIMIT_ROUTES.settings, adminRoute(empty, snapshot)],
  [AGENT_MEMORY_LIMIT_ROUTES.update, adminRoute(fields({ limit: count }), snapshot)],
]);
