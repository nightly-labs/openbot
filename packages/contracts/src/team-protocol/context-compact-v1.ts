import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CONTEXT_COMPACT_CAPABILITY = "context-compact-v1";

export const CONTEXT_COMPACT_ROUTES = {
  compact: "/v1/agent-context/compact",
  compactTask: "/v1/agent-context/compact-task",
} as const;

export const CONTEXT_COMPACT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONTEXT_COMPACT_ROUTES.compact, adminRoute(fields({ agentId: identifier }), empty)],
  [CONTEXT_COMPACT_ROUTES.compactTask, adminRoute(fields({ agentId: identifier, taskId: identifier }), empty)],
]);

export class ContextCompactRefusedError extends Error {}
