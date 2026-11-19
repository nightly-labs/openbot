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

export const MCP_SIGN_IN_CAPABILITY = "mcp-sign-in-v1";

export const MCP_SIGN_IN_ROUTES = {
  start: "/v1/admin/mcp-servers/sign-in/start",
  status: "/v1/admin/mcp-servers/sign-in/status",
  cancel: "/v1/admin/mcp-servers/sign-in/cancel",
  signOut: "/v1/admin/mcp-servers/sign-out",
  list: "/v1/admin/mcp-servers/sign-ins",
} as const;

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
const byUrl = fields({ url: string(2_048) });
const signIns = list(fields({ mcpServerId: identifier, signedIn: boolean }), 32);

export const MCP_SIGN_IN_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MCP_SIGN_IN_ROUTES.start, adminRoute(fields({ config }), empty)],
  [
    MCP_SIGN_IN_ROUTES.status,
    adminRoute(
      byUrl,
      fields({
        tabId: nullable(string(128)),
        result: nullable(fields({ toolCount: count, error: nullable(string(2_000)) })),
      }),
    ),
  ],
  [MCP_SIGN_IN_ROUTES.cancel, adminRoute(byUrl, empty)],
  [MCP_SIGN_IN_ROUTES.signOut, adminRoute(fields({ mcpServerId: identifier }), signIns)],
  [MCP_SIGN_IN_ROUTES.list, adminRoute(empty, signIns)],
]);
