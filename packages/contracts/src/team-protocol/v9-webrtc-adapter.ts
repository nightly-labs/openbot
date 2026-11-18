// The protocol 9 WebRTC frames: the protocol 8 ones, a compatibility response with up to 256
// capabilities, and an agent create request that can carry the `operationId` of
// agent-create-operation-v1. A protocol 9 client reads every host with it: a host that is older sends
// at most 128 capabilities, and a client sends `operationId` only to a host that advertises it.
import { isDynamicRecord } from "../runtime-values";
import { TEAM_API_ROUTES } from "../team-api-routes";
import { decodeAgentCreateOperation } from "./agent-create-operation-v1";
import { isAgentCreateRoute } from "./current";
import { decodeTeamProtocolV2Json } from "./v2";
import {
  decodeTeamProtocolV8WebRtcHttpRequest,
  decodeTeamProtocolV8WebRtcHttpResponse,
  encodeTeamProtocolV8WebRtcHttpRequest,
} from "./v8-webrtc-adapter";
import { decodeTeamProtocolSupportV9 } from "./v9";

export function decodeTeamProtocolV9WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200)
    return decodeTeamProtocolV2Json({ ...decodeTeamProtocolSupportV9(value) });
  return decodeTeamProtocolV8WebRtcHttpResponse(method, path, status, value);
}

type RequestOptions = { preserveSemanticTags?: boolean; agentCreateModel?: boolean };

export function encodeTeamProtocolV9WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: RequestOptions = {},
) {
  const encoded = encodeTeamProtocolV8WebRtcHttpRequest(method, path, value, options);
  if (!isAgentCreateRoute(method, path) || !isDynamicRecord(encoded)) return encoded;
  return decodeTeamProtocolV2Json({ ...encoded, ...decodeAgentCreateOperation(value) });
}

export function decodeTeamProtocolV9WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: RequestOptions = {},
) {
  const decoded = decodeTeamProtocolV8WebRtcHttpRequest(method, path, value, options);
  if (!isAgentCreateRoute(method, path) || !isDynamicRecord(decoded)) return decoded;
  return decodeTeamProtocolV2Json({ ...decoded, ...decodeAgentCreateOperation(value) });
}
