// Frozen optional agent-memory-limit-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set how many memories each agent on that server can keep. The snapshot gives
// the limit and the values the host permits, so a client offers only those. The host refuses any
// other value. A lower limit deletes no memory; an agent at or above it cannot add one. A member
// cannot use either route; `requireAdmin` on the host is the only gate. Widening any of it needs a
// second capability string.
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
