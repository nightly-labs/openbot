import { isDynamicRecord, isString } from "../runtime-values";
import { isBrowserDisplayRoute } from "./browser-navigation-v1";
import { isBrowserViewSessionRoute } from "./browser-view-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2EventFrame } from "./v2";
import {
  decodeTeamProtocolV3WebRtcHttpRequest,
  decodeTeamProtocolV3WebRtcHttpResponse,
  encodeTeamProtocolV3WebRtcHttpRequest,
  encodeTeamProtocolV3WebRtcHttpResponse,
} from "./v3-webrtc-adapter";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { decodeTeamProtocolV6BaseCurrentEvent, encodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";

export function encodeTeamProtocolV6WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
) {
  // A GET reaches the v3 frame, whose frozen no-body route list cannot learn a route added after it.
  // The display route carries no request body at all, so its frame is the empty object.
  if (isBrowserDisplayRoute(method, path) || isBrowserViewSessionRoute(method, path)) return {};
  if (method === "GET" || method === "DELETE" || isRoutineTestRequest(method, path) || isRemoteViewerRoute(path))
    return encodeTeamProtocolV3WebRtcHttpRequest(method, path, value, options);
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
  if (method === "GET" || method === "DELETE" || isRoutineTestRequest(method, path) || isRemoteViewerRoute(path))
    return decodeTeamProtocolV3WebRtcHttpRequest(method, path, value, options);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV6CurrentHttpRequest(method, path, value ?? {}, options));
}
export function encodeTeamProtocolV6WebRtcHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean; preserveBrowserSecrets?: boolean; historyExtent?: boolean } = {},
) {
  if (status === 204) return {};
  if (isRemoteViewerRoute(path)) return encodeTeamProtocolV3WebRtcHttpResponse(method, path, status, value, options);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV6CurrentHttpResponse(method, path, status, value ?? null, options)),
  );
}
export function decodeTeamProtocolV6WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (status === 204) return {};
  if (isRemoteViewerRoute(path)) return decodeTeamProtocolV3WebRtcHttpResponse(method, path, status, value);
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

function isRoutineTestRequest(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/v1\/agents\/[^/]+\/routines\/[^/]+\/test$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

function isRemoteViewerRoute(path: string): boolean {
  return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/(?:viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/u.test(
    new URL(path, "http://openbot.invalid").pathname,
  );
}
