import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "./v5";
import {
  decodeTeamProtocolV6BaseHttpRequest,
  decodeTeamProtocolV6BaseHttpResponse,
  TEAM_PROTOCOL_V6Base_CAPABILITIES,
  type TeamProtocolV6BaseJsonObject,
  type TeamProtocolV6BaseJsonValue,
} from "./v6-base";

export const TEAM_PROTOCOL_V6 = 6 as const;
/**
 * A peer that reads Cursor (`cursor`) and Cline (`cline`). The host answers it on protocol 6; a peer
 * without it stays on protocol 5 or older, which never names these providers.
 */
export const TEAM_CURSOR_CLINE_CAPABILITY = "local-providers-v2";
export const TEAM_PROTOCOL_V6_CAPABILITIES = [
  ...TEAM_PROTOCOL_V6Base_CAPABILITIES,
  "agent-duplication",
  "opencode",
  TEAM_LOCAL_PROVIDERS_CAPABILITY,
  TEAM_CURSOR_CLINE_CAPABILITY,
] as const;
export type TeamProtocolV6Capability = (typeof TEAM_PROTOCOL_V6_CAPABILITIES)[number];

export function decodeTeamProtocolV6HttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV6BaseJsonObject {
  if (duplicateRoute(method, path)) {
    if (
      !isDynamicRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isString(value.operationId) ||
      !isUuidV4(value.operationId)
    ) {
      throw new Error("Invalid Team protocol v6 duplicate-agent request.");
    }
    return { operationId: value.operationId };
  }
  return decodeTeamProtocolV6BaseHttpRequest(method, path, value);
}

export function decodeTeamProtocolV6HttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV6BaseJsonValue {
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV6BaseHttpResponse(method, path, status, value);
  if (status !== 201) return decodeTeamProtocolV6BaseHttpResponse("PATCH", agentPath(path), status, value);
  if (!isDynamicRecord(value) || !Object.hasOwn(value, "bot") || !Object.hasOwn(value, "layout")) {
    throw new Error("Invalid Team protocol v6 duplicate-agent response.");
  }
  const bots = decodeTeamProtocolV6BaseHttpResponse("GET", "/v1/agents", 200, [value.bot]);
  const layout = decodeTeamProtocolV6BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout);
  if (!Array.isArray(bots) || bots.length !== 1 || !isDynamicRecord(bots[0]) || !isDynamicRecord(layout)) {
    throw new Error("Invalid Team protocol v6 duplicate-agent response.");
  }
  return { bot: bots[0], layout };
}

function duplicateRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return method === "POST" && /^\/v1\/agents\/[^/]+\/duplicate$/u.test(pathname);
}

function agentPath(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname.replace(/\/duplicate$/u, "");
}
