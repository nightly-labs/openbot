// The protocol 10 WebRTC frames: the protocol 9 ones (`v9-webrtc-adapter.ts`), and a compatibility
// response that can have the protocol 10 lists. A protocol 10 client reads every host with it: only
// an answer to a protocol 10 request has `absent`, and an answer without it is read as protocol 9.
import { TEAM_API_ROUTES } from "../team-api-routes";
import { decodeTeamProtocolV9WebRtcHttpResponse } from "./v9-webrtc-adapter";
import { decodeTeamProtocolSupportV10, hasTeamProtocolV10Lists } from "./v10";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export function decodeTeamProtocolV10WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200 && hasTeamProtocolV10Lists(value))
    return decodeTeamProtocolV2Json({ ...decodeTeamProtocolSupportV10(value) });
  return decodeTeamProtocolV9WebRtcHttpResponse(method, path, status, value);
}
