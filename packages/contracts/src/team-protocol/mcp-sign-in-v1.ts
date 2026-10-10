// Frozen optional mcp-sign-in-v1 wire contract.
//
// An owner or admin of a joined server signs the host in to an OAuth MCP server. The host opens the
// server's sign-in page in a private tab of its own browser, and the client shows that tab with
// `browser-view`: the user signs in there, and the server sends the grant to the host's own loopback
// listener. No credential travels on these routes. A member cannot use any route; `requireAdmin` on
// the host is the only gate.
//
// `start` returns at once and the sign-in runs on the host. `status` answers `tabId` while the page
// is open and `result` once the sign-in ended, in the shape of an MCP test; both are `null` while the
// host looks for the page. `cancel` ends a waiting sign-in. `signOut` and `list` answer whether each
// http row of the host holds a sign-in, yes or no only.
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
// The configuration the form shows, saved or not: an empty id is a draft.
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
