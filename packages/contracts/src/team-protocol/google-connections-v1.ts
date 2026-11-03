// Frozen optional member-owned Google enrollment. Existing administrator relay routes stay unchanged.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
export const GOOGLE_CONNECTIONS_CAPABILITY = "google-connections-v1";
export const GOOGLE_CONNECTIONS_ROUTES = {
  state: "/v1/google-connections",
  configure: "/v1/google-connections/configure",
  start: "/v1/google-connections/sign-in/start",
  status: "/v1/google-connections/sign-in/status",
  complete: "/v1/google-connections/sign-in/complete",
  cancel: "/v1/google-connections/sign-in/cancel",
  assign: "/v1/google-connections/assign",
  disconnect: "/v1/google-connections/disconnect",
} as const;
const profile = fields({
  id: identifier,
  email: nullable(string(320)),
  connected: boolean,
  signingIn: boolean,
  agentId: nullable(identifier),
  agentName: nullable(string(1024)),
  eligibleAgentIds: list(identifier, 1000),
  error: nullable(string(2000)),
});
const named = fields({ id: identifier, name: string(1024) });
const snapshot = fields({
  configured: boolean,
  canConfigure: boolean,
  profiles: list(profile, 100),
  eligibleAgents: list(named, 1000),
  templates: list(named, 1000),
});
const relay = fields({
  authorizeUrl: nullable(string(8192)),
  callback: nullable(fields({ port: count, path: string(2048) })),
  result: nullable(fields({ toolCount: count, error: nullable(string(2000)) })),
});
export const GOOGLE_CONNECTIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [GOOGLE_CONNECTIONS_ROUTES.state, adminRoute(empty, snapshot)],
  [GOOGLE_CONNECTIONS_ROUTES.configure, adminRoute(fields({ mcpServerId: identifier }), snapshot)],
  [
    GOOGLE_CONNECTIONS_ROUTES.start,
    adminRoute(fields({ profileId: nullable(identifier) }), fields({ profileId: identifier, flowId: identifier })),
  ],
  [GOOGLE_CONNECTIONS_ROUTES.status, adminRoute(fields({ flowId: identifier }), relay)],
  [GOOGLE_CONNECTIONS_ROUTES.complete, adminRoute(fields({ flowId: identifier, query: string(8192) }), relay)],
  [GOOGLE_CONNECTIONS_ROUTES.cancel, adminRoute(fields({ flowId: identifier }), empty)],
  [GOOGLE_CONNECTIONS_ROUTES.assign, adminRoute(fields({ profileId: identifier, agentId: identifier }), snapshot)],
  [GOOGLE_CONNECTIONS_ROUTES.disconnect, adminRoute(fields({ profileId: identifier }), snapshot)],
]);
