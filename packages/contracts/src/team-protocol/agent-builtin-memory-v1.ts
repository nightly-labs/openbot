import { type AdminDecoder, adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_BUILTIN_MEMORY_CAPABILITY = "agent-builtin-memory-v1";

export const AGENT_BUILTIN_MEMORY_ROUTES = {
  settings: "/v1/admin/agents/builtin-memory",
  update: "/v1/admin/agents/builtin-memory/update",
} as const;

const settings: AdminDecoder = fields({ memory: boolean });

export const AGENT_BUILTIN_MEMORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_BUILTIN_MEMORY_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_BUILTIN_MEMORY_ROUTES.update, adminRoute(fields({ agentId: identifier, memory: boolean }), settings)],
]);
