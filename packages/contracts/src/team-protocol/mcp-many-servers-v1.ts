import { boolean, fields, identifier, list } from "./admin-wire";
import { MCP_SIGN_IN_ROUTES } from "./mcp-sign-in-v1";
import { isMcpRoute, MCP_ROUTES, mcpResponse, mcpServerConfigWire } from "./mcp-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const MCP_MANY_SERVERS_CAPABILITY = "mcp-many-servers-v1";
export const MCP_MANY_SERVERS_LIST_LIMIT = 100;
export const MCP_FROZEN_SERVERS_LIST_LIMIT = 32;

const configs = list(mcpServerConfigWire, 100);
const signIns = list(fields({ mcpServerId: identifier, signedIn: boolean }), 100);
const SIGN_IN_LIST_ROUTES: ReadonlySet<string> = new Set([MCP_SIGN_IN_ROUTES.list, MCP_SIGN_IN_ROUTES.signOut]);

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

export function mcpManyServersResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  return status < 400 && isMcpRoute(path) && pathname(path) !== MCP_ROUTES.test
    ? configs(value)
    : mcpResponse(path, status, value);
}

export function isMcpSignInListRoute(path: string): boolean {
  return SIGN_IN_LIST_ROUTES.has(pathname(path));
}

export function mcpManySignInsResponse(value: unknown): TeamProtocolV2Json {
  return signIns(value);
}
