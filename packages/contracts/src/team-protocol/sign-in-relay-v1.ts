// Frozen optional sign-in-relay-v1 wire contract.
//
// An owner or admin of a joined server signs the host in from their own computer. The host starts the
// sign-in and keeps the authorization page address; it opens no browser. The client opens that page
// in the user's own browser, and the page sends the user back to a loopback address. The client
// listens on that address on its own computer, and sends the query of the callback to the host with
// `complete`. The host finishes the sign-in. A member cannot use any route; `requireAdmin` on the host
// is the only gate.
//
// `mcp/start` and `provider/start` return a flow at once, and the sign-in runs on the host. `status` answers
// `authorizeUrl` once the host has the page address, `callback` when that page sends the user back to
// a loopback address on the host, and `result` once the sign-in ended. `callback` stays `null` when
// the address is not a loopback one: the client can then only send an address that the user pastes.
// `complete` takes only the query of the callback; the host builds the rest of the address from its
// own record. A flow completes once, only for the member who started it, and ends at `expiresAt`.
//
// `provider/start` signs in a provider's CLI on the host. Its page can return to the CLI's own loopback
// listener, which the host sends the query to, or it is a device page with no callback: the user only
// opens it, and the CLI finishes by itself.
//
// `link/start` relays a sign-in page that an agent of the host printed in its conversation, such as the
// page of an MCP server that the agent's CLI signs in to. The host accepts only an https page that
// returns to a loopback address with a `state`, and only when an agent message of `agentId` holds that
// exact address. The host sends the query to the loopback address of that page.
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

/** The providers whose sign-in `provider/start` relays. */
export const SIGN_IN_RELAY_PROVIDERS = ["codex", "claude", "antigravity", "muse"] as const;

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
const byFlow = fields({ flowId: identifier });
const started = fields({ flowId: identifier, expiresAt: count });
const flow = fields({
  authorizeUrl: nullable(string(8_192)),
  callback: nullable(fields({ port: count, path: string(2_048), state: nullable(string(1_024)) })),
  result: nullable(fields({ error: nullable(string(2_000)) }, { toolCount: count })),
});

/** The codec of `mcp/start`, which `sign-in-relay-deep-link-v1` uses for its own start route too. */
export const SIGN_IN_RELAY_MCP_START_CODEC = adminRoute(fields({ config }), started);

export const SIGN_IN_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIGN_IN_RELAY_ROUTES.mcpStart, SIGN_IN_RELAY_MCP_START_CODEC],
  [SIGN_IN_RELAY_ROUTES.providerStart, adminRoute(fields({ provider: oneOf(...SIGN_IN_RELAY_PROVIDERS) }), started)],
  [SIGN_IN_RELAY_ROUTES.linkStart, adminRoute(fields({ agentId: identifier, url: string(8_192) }), started)],
  [SIGN_IN_RELAY_ROUTES.status, adminRoute(byFlow, flow)],
  [SIGN_IN_RELAY_ROUTES.complete, adminRoute(fields({ flowId: identifier, query: string(8_192) }), flow)],
  [SIGN_IN_RELAY_ROUTES.cancel, adminRoute(byFlow, empty)],
]);
