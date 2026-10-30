import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import { TEAM_PROTOCOL_V7_CAPABILITIES } from "./v7";
import {
  decodeTeamProtocolV8BaseHttpRequest,
  decodeTeamProtocolV8BaseHttpResponse,
  type TeamProtocolV8BaseJsonObject,
  type TeamProtocolV8BaseJsonValue,
} from "./v8-base";

export const TEAM_PROTOCOL_V8 = 8 as const;
/**
 * A peer that reads a provider id it does not know. The host answers it on protocol 8 and sends every
 * provider; a peer without it stays on protocol 7 or older, which sees only the providers its
 * protocol names.
 */
export const TEAM_OPEN_PROVIDERS_CAPABILITY = "open-providers-v1";
export const TEAM_PROTOCOL_V8_CAPABILITIES = [
  ...TEAM_PROTOCOL_V7_CAPABILITIES,
  TEAM_OPEN_PROVIDERS_CAPABILITY,
] as const;
export type TeamProtocolV8Capability = (typeof TEAM_PROTOCOL_V8_CAPABILITIES)[number];

export function decodeTeamProtocolV8HttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV8BaseJsonObject {
  if (duplicateRoute(method, path)) {
    if (
      !isDynamicRecord(value) ||
      Object.keys(value).length !== 1 ||
      !isString(value.operationId) ||
      !isUuidV4(value.operationId)
    ) {
      throw new Error("Invalid Team protocol v8 duplicate-agent request.");
    }
    return { operationId: value.operationId };
  }
  return decodeTeamProtocolV8BaseHttpRequest(method, path, value);
}

export function decodeTeamProtocolV8HttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV8BaseJsonValue {
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV8BaseHttpResponse(method, path, status, value);
  if (status !== 201) return decodeTeamProtocolV8BaseHttpResponse("PATCH", agentPath(path), status, value);
  if (!isDynamicRecord(value) || !Object.hasOwn(value, "bot") || !Object.hasOwn(value, "layout")) {
    throw new Error("Invalid Team protocol v8 duplicate-agent response.");
  }
  const bots = decodeTeamProtocolV8BaseHttpResponse("GET", "/v1/agents", 200, [value.bot]);
  const layout = decodeTeamProtocolV8BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout);
  if (!Array.isArray(bots) || bots.length !== 1 || !isDynamicRecord(bots[0]) || !isDynamicRecord(layout)) {
    throw new Error("Invalid Team protocol v8 duplicate-agent response.");
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
