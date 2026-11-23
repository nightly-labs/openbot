import type { OptionalRouteCodec } from "./admin-wire";
import { SIGN_IN_RELAY_MCP_START_CODEC } from "./sign-in-relay-v1";

export const SIGN_IN_RELAY_DEEP_LINK_CAPABILITY = "sign-in-relay-deep-link-v1";

export const SIGN_IN_RELAY_DEEP_LINK_ROUTES = {
  mcpStart: "/v1/admin/sign-in-relay/mcp/start-deep-link",
} as const;

export const SIGN_IN_RELAY_DEEP_LINK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIGN_IN_RELAY_DEEP_LINK_ROUTES.mcpStart, SIGN_IN_RELAY_MCP_START_CODEC],
]);
