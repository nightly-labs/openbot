// The protocol 10 WebRTC frames: the protocol 9 ones, with a compatibility response of up to 512
// capabilities. A protocol 10 client reads every host with it: a host that is older sends at most 256.
import { TEAM_API_ROUTES } from "../team-api-routes";
import { decodeTeamProtocolV2Json } from "./v2";
import {
  decodeTeamProtocolV9WebRtcHttpRequest,
  decodeTeamProtocolV9WebRtcHttpResponse,
  encodeTeamProtocolV9WebRtcHttpRequest,
} from "./v9-webrtc-adapter";
import { decodeTeamProtocolSupportV10 } from "./v10";

export function decodeTeamProtocolV10WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility && status === 200)
    return decodeTeamProtocolV2Json({ ...decodeTeamProtocolSupportV10(value) });
  return decodeTeamProtocolV9WebRtcHttpResponse(method, path, status, value);
}

/** Protocol 10 requests are the protocol 9 ones. */
export const encodeTeamProtocolV10WebRtcHttpRequest = encodeTeamProtocolV9WebRtcHttpRequest;
export const decodeTeamProtocolV10WebRtcHttpRequest = decodeTeamProtocolV9WebRtcHttpRequest;
