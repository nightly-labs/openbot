import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CONTEXT_RESET_CAPABILITY = "context-reset-v1";

export const CONTEXT_RESET_ROUTES = {
  clear: "/v1/agent-context/clear",
} as const;

export const CONTEXT_RESET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONTEXT_RESET_ROUTES.clear, adminRoute(fields({ agentId: identifier }), empty)],
]);

export class ContextResetBusyError extends Error {}
