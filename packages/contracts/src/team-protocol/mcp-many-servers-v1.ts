// Frozen optional mcp-many-servers-v1 contract. Keep IPC types and limits out of this file: every
// bound is written as a literal, so a change to `INPUT_LIMITS` cannot move a shipped wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: when both peers send it, a
// list of MCP servers in a response of `mcp-servers-v1`, and the list of sign-ins in a response of
// `mcp-sign-in-v1`, can hold 100 rows and not 32. Each row keeps the frozen shape and bounds of its
// own contract. Requests do not change. Without it on either side, a host that holds more than 32
// servers refuses these routes with an error that asks for an update, and never sends a list that
// the frozen codecs refuse. A protocol 9 capability only. Widening any of it needs a second
// capability string.
import { boolean, fields, identifier, list } from "./admin-wire";
import { MCP_SIGN_IN_ROUTES } from "./mcp-sign-in-v1";
import { isMcpRoute, MCP_ROUTES, mcpResponse, mcpServerConfigWire } from "./mcp-v1";
import type { TeamProtocolV2Json } from "./v2";

export const MCP_MANY_SERVERS_CAPABILITY = "mcp-many-servers-v1";
/** The rows of one list for a peer that sends `mcp-many-servers-v1`. */
export const MCP_MANY_SERVERS_LIST_LIMIT = 100;
/** The rows of one list in `mcp-servers-v1` and `mcp-sign-in-v1` alone. */
export const MCP_FROZEN_SERVERS_LIST_LIMIT = 32;

const configs = list(mcpServerConfigWire, 100);
const signIns = list(fields({ mcpServerId: identifier, signedIn: boolean }), 100);
const SIGN_IN_LIST_ROUTES: ReadonlySet<string> = new Set([MCP_SIGN_IN_ROUTES.list, MCP_SIGN_IN_ROUTES.signOut]);

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

/** A response of `mcp-servers-v1` with the longer list. Every other response keeps its frozen codec. */
export function mcpManyServersResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  return status < 400 && isMcpRoute(path) && pathname(path) !== MCP_ROUTES.test
    ? configs(value)
    : mcpResponse(path, status, value);
}

/** The `mcp-sign-in-v1` routes that answer with the list of sign-ins. */
export function isMcpSignInListRoute(path: string): boolean {
  return SIGN_IN_LIST_ROUTES.has(pathname(path));
}

/** A successful response of an `isMcpSignInListRoute` route, with the longer list. */
export function mcpManySignInsResponse(value: unknown): TeamProtocolV2Json {
  return signIns(value);
}
