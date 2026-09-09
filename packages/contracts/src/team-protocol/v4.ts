import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import {
  decodeTeamProtocolV4BaseHttpRequest,
  decodeTeamProtocolV4BaseHttpResponse,
  TEAM_PROTOCOL_V4Base_CAPABILITIES,
  type TeamProtocolV4BaseJsonObject,
  type TeamProtocolV4BaseJsonValue,
} from "./v4-base";

export const TEAM_PROTOCOL_V4 = 4 as const;
export const TEAM_PROTOCOL_V4_CAPABILITIES = [
  ...TEAM_PROTOCOL_V4Base_CAPABILITIES,
  "agent-duplication",
  "opencode",
] as const;
export type TeamProtocolV4Capability = (typeof TEAM_PROTOCOL_V4_CAPABILITIES)[number];

export function decodeTeamProtocolV4HttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV4BaseJsonObject {
  if (duplicateRoute(method, path)) {
    if (
      !isDynamicRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isString(value.operationId) ||
      !isUuidV4(value.operationId)
    ) {
      throw new Error("Invalid Team protocol v4 duplicate-agent request.");
    }
    return { operationId: value.operationId };
  }
  return decodeTeamProtocolV4BaseHttpRequest(method, path, value);
}

export function decodeTeamProtocolV4HttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV4BaseJsonValue {
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV4BaseHttpResponse(method, path, status, value);
  if (status !== 201) return decodeTeamProtocolV4BaseHttpResponse("PATCH", agentPath(path), status, value);
  if (!isDynamicRecord(value) || !Object.hasOwn(value, "bot") || !Object.hasOwn(value, "layout")) {
    throw new Error("Invalid Team protocol v4 duplicate-agent response.");
  }
  const bots = decodeTeamProtocolV4BaseHttpResponse("GET", "/v1/agents", 200, [value.bot]);
  const layout = decodeTeamProtocolV4BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout);
  if (!Array.isArray(bots) || bots.length !== 1 || !isDynamicRecord(bots[0]) || !isDynamicRecord(layout)) {
    throw new Error("Invalid Team protocol v4 duplicate-agent response.");
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
