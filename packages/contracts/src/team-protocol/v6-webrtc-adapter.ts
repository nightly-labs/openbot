import { isDynamicRecord, isString } from "../runtime-values";
import { isBrowserDisplayRoute } from "./browser-navigation-v1";
import { isBrowserViewSessionRoute } from "./browser-view-v1";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { decodeTeamProtocolV6BaseCurrentEvent, encodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";
import {
  isTeamWebRtcBodylessRoute,
  isTeamWebRtcRemoteViewerRoute,
  teamWebRtcBodylessRequest,
  teamWebRtcRemoteViewerResponse,
} from "./webrtc-bodyless-requests";
import { decodeTeamProtocolV2Json, type TeamProtocolV2EventFrame } from "./webrtc-framing";

export function encodeTeamProtocolV6WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
) {
  if (isBrowserDisplayRoute(method, path) || isBrowserViewSessionRoute(method, path)) return {};
  if (isTeamWebRtcBodylessRoute(method, path)) return teamWebRtcBodylessRequest(method, path, value);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV6CurrentHttpRequest(method, path, value ?? {}, options)),
  );
}
export function decodeTeamProtocolV6WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
) {
  if (isBrowserDisplayRoute(method, path) || isBrowserViewSessionRoute(method, path)) return {};
  if (isTeamWebRtcBodylessRoute(method, path)) return teamWebRtcBodylessRequest(method, path, value);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV6CurrentHttpRequest(method, path, value ?? {}, options));
}
export function encodeTeamProtocolV6WebRtcHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
) {
  if (status === 204) return {};
  if (isTeamWebRtcRemoteViewerRoute(path)) return teamWebRtcRemoteViewerResponse(value);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV6CurrentHttpResponse(method, path, status, value ?? null, options)),
  );
}
export function decodeTeamProtocolV6WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (status === 204) return {};
  if (isTeamWebRtcRemoteViewerRoute(path)) return teamWebRtcRemoteViewerResponse(value);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV6CurrentHttpResponse(method, path, status, value ?? null));
}
export function createTeamProtocolV6Event(
  sequence: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean } = {},
): TeamProtocolV2EventFrame {
  const decoded = decodeTeamProtocolV6BaseCurrentEvent(value);
  if (decoded.kind !== "known") throw new Error("Invalid Team protocol v6 event.");
  const encoded = encodeTeamProtocolV6BaseCurrentEvent(decoded.event, options);
  if (!encoded) throw new Error("Invalid Team protocol v6 event.");
  return { version: 2, type: "event", sequence, payload: decodeTeamProtocolV2Json(JSON.parse(encoded)) };
}
export function decodeTeamProtocolV6CurrentEvent(frame: TeamProtocolV2EventFrame) {
  if (frame.type !== "event") return { status: "invalid" as const };
  const decoded = decodeTeamProtocolV6BaseCurrentEvent(frame.payload);
  if (decoded.kind === "invalid" && !(isDynamicRecord(frame.payload) && isString(frame.payload.type)))
    return { status: "unknown" as const };
  return decoded.kind === "known" ? { status: "known" as const, event: decoded.event } : { status: decoded.kind };
}
