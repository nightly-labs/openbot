import { TEAM_API_ROUTES } from "../team-api-routes";
import { decodeTeamProtocolV9WebRtcHttpResponse } from "./v9-webrtc-adapter";
import { decodeTeamProtocolSupportV10, hasTeamProtocolV10Lists } from "./v10";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export function decodeTeamProtocolV10WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200 && hasTeamProtocolV10Lists(value))
    return decodeTeamProtocolV2Json({ ...decodeTeamProtocolSupportV10(value) });
  return decodeTeamProtocolV9WebRtcHttpResponse(method, path, status, value);
}
