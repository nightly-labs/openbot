// The protocol 9 WebRTC responses: the protocol 8 ones, and a compatibility response with up to 256
// capabilities. A protocol 9 client reads every host with it: a host that is older sends at most 128.
import { TEAM_API_ROUTES } from "../team-api-routes";
import { decodeTeamProtocolV2Json } from "./v2";
import { decodeTeamProtocolV8WebRtcHttpResponse } from "./v8-webrtc-adapter";
import { decodeTeamProtocolSupportV9 } from "./v9";

export function decodeTeamProtocolV9WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200)
    return decodeTeamProtocolV2Json({ ...decodeTeamProtocolSupportV9(value) });
  return decodeTeamProtocolV8WebRtcHttpResponse(method, path, status, value);
}
