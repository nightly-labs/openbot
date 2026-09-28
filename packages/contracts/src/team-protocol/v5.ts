import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import {
  decodeTeamProtocolV5BaseHttpRequest,
  decodeTeamProtocolV5BaseHttpResponse,
  TEAM_PROTOCOL_V5Base_CAPABILITIES,
  type TeamProtocolV5BaseJsonObject,
  type TeamProtocolV5BaseJsonValue,
} from "./v5-base";

export const TEAM_PROTOCOL_V5 = 5 as const;
/**
 * A peer that reads Gemini (`antigravity`) and custom ACP agents (`acp`). The host answers it on
 * protocol 5; a peer without it stays on protocol 4, which never names these providers.
 */
export const TEAM_LOCAL_PROVIDERS_CAPABILITY = "local-providers";
export const TEAM_PROTOCOL_V5_CAPABILITIES = [
  ...TEAM_PROTOCOL_V5Base_CAPABILITIES,
  "agent-duplication",
  "opencode",
  TEAM_LOCAL_PROVIDERS_CAPABILITY,
] as const;
export type TeamProtocolV5Capability = (typeof TEAM_PROTOCOL_V5_CAPABILITIES)[number];

export function decodeTeamProtocolV5HttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV5BaseJsonObject {
  if (duplicateRoute(method, path)) {
    if (
      !isDynamicRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isString(value.operationId) ||
      !isUuidV4(value.operationId)
    ) {
      throw new Error("Invalid Team protocol v5 duplicate-agent request.");
    }
    return { operationId: value.operationId };
  }
  return decodeTeamProtocolV5BaseHttpRequest(method, path, value);
}

export function decodeTeamProtocolV5HttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV5BaseJsonValue {
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV5BaseHttpResponse(method, path, status, value);
  if (status !== 201) return decodeTeamProtocolV5BaseHttpResponse("PATCH", agentPath(path), status, value);
  if (!isDynamicRecord(value) || !Object.hasOwn(value, "bot") || !Object.hasOwn(value, "layout")) {
    throw new Error("Invalid Team protocol v5 duplicate-agent response.");
  }
  const bots = decodeTeamProtocolV5BaseHttpResponse("GET", "/v1/agents", 200, [value.bot]);
  const layout = decodeTeamProtocolV5BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout);
  if (!Array.isArray(bots) || bots.length !== 1 || !isDynamicRecord(bots[0]) || !isDynamicRecord(layout)) {
    throw new Error("Invalid Team protocol v5 duplicate-agent response.");
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
