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
  oneOf,
  string,
} from "./admin-wire";

export const SIGN_IN_RELAY_CAPABILITY = "sign-in-relay-v1";

export const SIGN_IN_RELAY_ROUTES = {
  mcpStart: "/v1/admin/sign-in-relay/mcp/start",
  providerStart: "/v1/admin/sign-in-relay/provider/start",
  linkStart: "/v1/admin/sign-in-relay/link/start",
  status: "/v1/admin/sign-in-relay/status",
  complete: "/v1/admin/sign-in-relay/complete",
  cancel: "/v1/admin/sign-in-relay/cancel",
} as const;

export const SIGN_IN_RELAY_PROVIDERS = ["codex", "claude", "antigravity", "muse"] as const;

const pair = fields({ key: string(255), value: string(8_192) });
const config = fields({
  id: string(128),
  name: string(80),
  transport: oneOf("stdio", "http"),
  enabled: boolean,
  command: string(4_096),
  args: list(string(4_096), 64),
  env: list(pair, 64),
  envPassthrough: list(string(255), 64),
  workingDirectory: string(4_096),
  url: string(2_048),
  headers: list(pair, 32),
});
const byFlow = fields({ flowId: identifier });
const started = fields({ flowId: identifier, expiresAt: count });
const flow = fields({
  authorizeUrl: nullable(string(8_192)),
  callback: nullable(fields({ port: count, path: string(2_048), state: nullable(string(1_024)) })),
  result: nullable(fields({ error: nullable(string(2_000)) }, { toolCount: count })),
});

export const SIGN_IN_RELAY_MCP_START_CODEC = adminRoute(fields({ config }), started);

export const SIGN_IN_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIGN_IN_RELAY_ROUTES.mcpStart, SIGN_IN_RELAY_MCP_START_CODEC],
  [SIGN_IN_RELAY_ROUTES.providerStart, adminRoute(fields({ provider: oneOf(...SIGN_IN_RELAY_PROVIDERS) }), started)],
  [SIGN_IN_RELAY_ROUTES.linkStart, adminRoute(fields({ agentId: identifier, url: string(8_192) }), started)],
  [SIGN_IN_RELAY_ROUTES.status, adminRoute(byFlow, flow)],
  [SIGN_IN_RELAY_ROUTES.complete, adminRoute(fields({ flowId: identifier, query: string(8_192) }), flow)],
  [SIGN_IN_RELAY_ROUTES.cancel, adminRoute(byFlow, empty)],
]);
