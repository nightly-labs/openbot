import { isDynamicRecord, isString } from "../runtime-values";
import { isBrowserDisplayRoute } from "./browser-navigation-v1";
import { isBrowserViewSessionRoute } from "./browser-view-v1";
import {
  decodeTeamProtocolV5CurrentHttpRequest,
  decodeTeamProtocolV5CurrentHttpResponse,
  encodeTeamProtocolV5CurrentHttpRequest,
  encodeTeamProtocolV5CurrentHttpResponse,
} from "./v5-adapter";
import { decodeTeamProtocolV5BaseCurrentEvent, encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import {
  isTeamWebRtcBodylessRoute,
  isTeamWebRtcRemoteViewerRoute,
  teamWebRtcBodylessRequest,
  teamWebRtcRemoteViewerResponse,
} from "./webrtc-bodyless-requests";
import { decodeTeamProtocolV2Json, type TeamProtocolV2EventFrame } from "./webrtc-framing";

export function encodeTeamProtocolV5WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
) {
  // A GET reaches the bodyless frame, whose frozen no-body route list cannot learn a route added after it.
  // The display route carries no request body at all, so its frame is the empty object.
  if (isBrowserDisplayRoute(method, path) || isBrowserViewSessionRoute(method, path)) return {};
  if (isTeamWebRtcBodylessRoute(method, path)) return teamWebRtcBodylessRequest(method, path, value);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV5CurrentHttpRequest(method, path, value ?? {}, options)),
  );
}
export function decodeTeamProtocolV5WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
) {
  if (isBrowserDisplayRoute(method, path) || isBrowserViewSessionRoute(method, path)) return {};
  if (isTeamWebRtcBodylessRoute(method, path)) return teamWebRtcBodylessRequest(method, path, value);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV5CurrentHttpRequest(method, path, value ?? {}, options));
}
export function encodeTeamProtocolV5WebRtcHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
) {
  if (status === 204) return {};
  if (isTeamWebRtcRemoteViewerRoute(path)) return teamWebRtcRemoteViewerResponse(value);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV5CurrentHttpResponse(method, path, status, value ?? null, options)),
  );
}
export function decodeTeamProtocolV5WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (status === 204) return {};
  if (isTeamWebRtcRemoteViewerRoute(path)) return teamWebRtcRemoteViewerResponse(value);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV5CurrentHttpResponse(method, path, status, value ?? null));
}
export function createTeamProtocolV5Event(
  sequence: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
): TeamProtocolV2EventFrame {
  const decoded = decodeTeamProtocolV5BaseCurrentEvent(value);
  if (decoded.kind !== "known") throw new Error("Invalid Team protocol v5 event.");
  const encoded = encodeTeamProtocolV5BaseCurrentEvent(decoded.event, options);
  if (!encoded) throw new Error("Invalid Team protocol v5 event.");
  return { version: 2, type: "event", sequence, payload: decodeTeamProtocolV2Json(JSON.parse(encoded)) };
}
export function decodeTeamProtocolV5CurrentEvent(frame: TeamProtocolV2EventFrame) {
  if (frame.type !== "event") return { status: "invalid" as const };
  const decoded = decodeTeamProtocolV5BaseCurrentEvent(frame.payload);
  if (decoded.kind === "invalid" && !(isDynamicRecord(frame.payload) && isString(frame.payload.type)))
    return { status: "unknown" as const };
  return decoded.kind === "known" ? { status: "known" as const, event: decoded.event } : { status: decoded.kind };
}
