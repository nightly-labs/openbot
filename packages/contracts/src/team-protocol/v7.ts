import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "./v5";
import {
  decodeTeamProtocolV7BaseHttpRequest,
  decodeTeamProtocolV7BaseHttpResponse,
  TEAM_PROTOCOL_V7Base_CAPABILITIES,
  type TeamProtocolV7BaseJsonObject,
  type TeamProtocolV7BaseJsonValue,
} from "./v7-base";

export const TEAM_PROTOCOL_V7 = 7 as const;
/**
 * A peer that reads Pi (`pi`) and Muse (`muse`). The host answers it on protocol 7; a peer
 * without it stays on protocol 6 or older, which never names these providers.
 */
export const TEAM_PI_MUSE_CAPABILITY = "local-providers-v3";
export const TEAM_PROTOCOL_V7_CAPABILITIES = [
  ...TEAM_PROTOCOL_V7Base_CAPABILITIES,
  "agent-duplication",
  "opencode",
  TEAM_LOCAL_PROVIDERS_CAPABILITY,
  "local-providers-v2",
  TEAM_PI_MUSE_CAPABILITY,
] as const;
export type TeamProtocolV7Capability = (typeof TEAM_PROTOCOL_V7_CAPABILITIES)[number];

export function decodeTeamProtocolV7HttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV7BaseJsonObject {
  if (duplicateRoute(method, path)) {
    if (
      !isDynamicRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isString(value.operationId) ||
      !isUuidV4(value.operationId)
    ) {
      throw new Error("Invalid Team protocol v7 duplicate-agent request.");
    }
    return { operationId: value.operationId };
  }
  return decodeTeamProtocolV7BaseHttpRequest(method, path, value);
}

export function decodeTeamProtocolV7HttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV7BaseHttpResponse(method, path, status, value);
  if (status !== 201) return decodeTeamProtocolV7BaseHttpResponse("PATCH", agentPath(path), status, value);
  if (!isDynamicRecord(value) || !Object.hasOwn(value, "bot") || !Object.hasOwn(value, "layout")) {
    throw new Error("Invalid Team protocol v7 duplicate-agent response.");
  }
  const bots = decodeTeamProtocolV7BaseHttpResponse("GET", "/v1/agents", 200, [value.bot]);
  const layout = decodeTeamProtocolV7BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout);
  if (!Array.isArray(bots) || bots.length !== 1 || !isDynamicRecord(bots[0]) || !isDynamicRecord(layout)) {
    throw new Error("Invalid Team protocol v7 duplicate-agent response.");
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
