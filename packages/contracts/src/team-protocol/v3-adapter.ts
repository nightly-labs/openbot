import { decodeAgentAnalytics } from "../ipc-agent-analytics";
import { decodeHostAnalytics } from "../ipc-host-analytics";
import { decodeAnalyticsV1Response } from "./analytics-v1";
import { isAgentAnalyticsRoute, isAgentProfileRoute, isConversationUnreadRoute, isHostAnalyticsRoute } from "./current";
import {
  currentProfileRoutes,
  decodeScopedUsageRequest,
  decodeUnreadRequest,
  duplicateRoute,
  readPath,
  scopedUsageRoute,
} from "./current-adapter-routes";
import { toCurrentAgentKeys, toCurrentAgentKeysObjectForPath, toWireAgentKeys } from "./current-agent-keys";
import { decodeHostAnalyticsV1Response } from "./host-analytics-v1";
import { decodeProfileV1Request, decodeProfileV1Response } from "./profile-v1";
import { decodeQueueEditRequest, isQueueEditRoute } from "./queue-edit-v1";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "./v1";
import {
  decodeTeamProtocolV1CurrentHttpRequest,
  decodeTeamProtocolV1CurrentHttpResponse,
  encodeTeamProtocolV1CurrentHttpRequest,
  encodeTeamProtocolV1CurrentHttpResponse,
} from "./v1-adapter";
import { decodeTeamProtocolV3HttpRequest, decodeTeamProtocolV3HttpResponse } from "./v3";

const profile = currentProfileRoutes({
  decodeRequest: decodeProfileV1Request,
  decodeResponse: decodeProfileV1Response,
});

export function encodeTeamProtocolV3CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  if (isQueueEditRoute(method, path)) return JSON.stringify(decodeQueueEditRequest(value));
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path))
    return JSON.stringify(decodeScopedUsageRequest(value));
  if (isAgentProfileRoute(method, path)) return JSON.stringify(profile.encodeRequest(path, value));
  if (isConversationUnreadRoute(method, path)) return JSON.stringify(decodeUnreadRequest(value));
  if (scopedUsageRoute(method, path)) {
    return JSON.stringify(decodeScopedUsageRequest(value));
  }
  if (!duplicateRoute(method, path)) return encodeTeamProtocolV1CurrentHttpRequest(method, path, value, options);
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
  const currentValue: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV3HttpRequest(method, path, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV3CurrentHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): TeamProtocolV1JsonObject {
  if (isQueueEditRoute(method, path)) return { ...decodeQueueEditRequest(value) };
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) return decodeScopedUsageRequest(value);
  if (isAgentProfileRoute(method, path)) return profile.decodeRequest(path, value);
  if (isConversationUnreadRoute(method, path)) return decodeUnreadRequest(value);
  if (scopedUsageRoute(method, path)) {
    return decodeScopedUsageRequest(value);
  }
  if (!duplicateRoute(method, path)) {
    if (options.preserveSemanticTags) return decodeTeamProtocolV1CurrentHttpRequest(method, path, value);
    // The encode call is only here to expand semantic tags, and it leaves the object in wire vocabulary.
    // Decoding its output is what brings the keys back to the current spelling the handlers read.
    return decodeTeamProtocolV1CurrentHttpRequest(
      method,
      path,
      JSON.parse(encodeTeamProtocolV1CurrentHttpRequest(method, path, value)),
    );
  }
  return toCurrentAgentKeysObjectForPath(path, structuredClone(decodeTeamProtocolV3HttpRequest(method, path, value)));
}

export function encodeTeamProtocolV3CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): string {
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeHostAnalyticsV1Response(decodeHostAnalytics(value)));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.stringify(decodeAnalyticsV1Response(decodeAgentAnalytics(value)));
  if (isAgentProfileRoute(method, path) && status < 400) return JSON.stringify(profile.encodeResponse(path, value));
  if (isQueueEditRoute(method, path) && status === 204) return "{}";
  if (isQueueEditRoute(method, path))
    return encodeTeamProtocolV1CurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value, options);
  if (isConversationUnreadRoute(method, path))
    return encodeTeamProtocolV1CurrentHttpResponse(method, readPath(path), status, value, options);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return encodeTeamProtocolV1CurrentHttpResponse(method, "/v1/agents/usage", status, value, options);
  }
  if (!duplicateRoute(method, path)) {
    return encodeTeamProtocolV1CurrentHttpResponse(method, path, status, value, options);
  }
  // The duplicate route reaches the frozen v3 codec directly, so the vocabulary swap happens here.
  const currentValue: TeamProtocolV1JsonValue = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(decodeTeamProtocolV3HttpResponse(method, path, status, toWireAgentKeys(currentValue)));
}

export function decodeTeamProtocolV3CurrentHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV1JsonValue {
  if (isHostAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeHostAnalytics(decodeHostAnalyticsV1Response(value))));
  if (isAgentAnalyticsRoute(method, path) && status < 400)
    return JSON.parse(JSON.stringify(decodeAgentAnalytics(decodeAnalyticsV1Response(value))));
  if (isAgentProfileRoute(method, path) && status < 400) return profile.decodeResponse(path, value);
  if (isQueueEditRoute(method, path) && status === 204) return {};
  if (isQueueEditRoute(method, path))
    return decodeTeamProtocolV1CurrentHttpResponse("GET", "/v1/agents/queue/queue", status, value);
  if (isConversationUnreadRoute(method, path))
    return decodeTeamProtocolV1CurrentHttpResponse(method, readPath(path), status, value);
  if (scopedUsageRoute(method, path) || isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path)) {
    return decodeTeamProtocolV1CurrentHttpResponse(method, "/v1/agents/usage", status, value);
  }
  if (!duplicateRoute(method, path)) return decodeTeamProtocolV1CurrentHttpResponse(method, path, status, value);
  return toCurrentAgentKeys(structuredClone(decodeTeamProtocolV3HttpResponse(method, path, status, value)));
}
