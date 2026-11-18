// Frozen optional sign-in-relay-deep-link-v1 wire contract.
//
// `mcp/start-deep-link` starts the same relayed MCP sign-in as `mcp/start` of `sign-in-relay-v1`, with
// the same body and answer. The client sends it only when the operating system of its computer opens
// `openbot://mcp-auth` in OpenBot. The host can then send the browser back to `openbot://mcp-auth`: it
// does so after its sign-ins of the same address got no grant back on `127.0.0.1` and then on
// `localhost`, as a sign-in in the host's own browser does. TradingView's firewall blocks its sign-in
// page when the page returns to a loopback address (#9209). `status` then answers `callback: null`,
// the client takes the callback from the link by its `state`, and sends its query with `complete` of
// `sign-in-relay-v1`. The host needs `sign-in-relay-v1` too, and the access rules are those of
// `mcp/start`.
import type { OptionalRouteCodec } from "./admin-wire";
import { SIGN_IN_RELAY_MCP_START_CODEC } from "./sign-in-relay-v1";

export const SIGN_IN_RELAY_DEEP_LINK_CAPABILITY = "sign-in-relay-deep-link-v1";

export const SIGN_IN_RELAY_DEEP_LINK_ROUTES = {
  mcpStart: "/v1/admin/sign-in-relay/mcp/start-deep-link",
} as const;

export const SIGN_IN_RELAY_DEEP_LINK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIGN_IN_RELAY_DEEP_LINK_ROUTES.mcpStart, SIGN_IN_RELAY_MCP_START_CODEC],
]);
