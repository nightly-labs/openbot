import { isDynamicRecord, isString } from "../runtime-values";
import { decodeTeamProtocolV2Json, type TeamProtocolV2EventFrame } from "./v2";
import { decodeTeamProtocolV3WebRtcHttpRequest, encodeTeamProtocolV3WebRtcHttpRequest } from "./v3-webrtc-adapter";
import {
  decodeTeamProtocolV4CurrentHttpRequest,
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpRequest,
  encodeTeamProtocolV4CurrentHttpResponse,
} from "./v4-adapter";
import { decodeTeamProtocolV4BaseCurrentEvent, encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";

export function encodeTeamProtocolV4WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
) {
  if (method === "GET" || method === "DELETE" || isRoutineTestRequest(method, path))
    return encodeTeamProtocolV3WebRtcHttpRequest(method, path, value, options);
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV4CurrentHttpRequest(method, path, value ?? {}, options)),
  );
}
export function decodeTeamProtocolV4WebRtcHttpRequest(
  method: string,
  path: string,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
) {
  if (method === "GET" || method === "DELETE" || isRoutineTestRequest(method, path))
    return decodeTeamProtocolV3WebRtcHttpRequest(method, path, value, options);
  return decodeTeamProtocolV2Json(decodeTeamProtocolV4CurrentHttpRequest(method, path, value ?? {}, options));
}
export function encodeTeamProtocolV4WebRtcHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
) {
  if (status === 204) return {};
  return decodeTeamProtocolV2Json(
    JSON.parse(encodeTeamProtocolV4CurrentHttpResponse(method, path, status, value ?? null, options)),
  );
}
export function decodeTeamProtocolV4WebRtcHttpResponse(method: string, path: string, status: number, value: unknown) {
  if (status === 204) return {};
  return decodeTeamProtocolV2Json(decodeTeamProtocolV4CurrentHttpResponse(method, path, status, value ?? null));
}
export function createTeamProtocolV4Event(
  sequence: number,
  value: unknown,
  options: { preserveSemanticTags?: boolean } = {},
): TeamProtocolV2EventFrame {
  const decoded = decodeTeamProtocolV4BaseCurrentEvent(value);
  if (decoded.kind !== "known") throw new Error("Invalid Team protocol v4 event.");
  const encoded = encodeTeamProtocolV4BaseCurrentEvent(decoded.event, options);
  if (!encoded) throw new Error("Invalid Team protocol v4 event.");
  return { version: 2, type: "event", sequence, payload: decodeTeamProtocolV2Json(JSON.parse(encoded)) };
}
export function decodeTeamProtocolV4CurrentEvent(frame: TeamProtocolV2EventFrame) {
  if (frame.type !== "event") return { status: "invalid" as const };
  const decoded = decodeTeamProtocolV4BaseCurrentEvent(frame.payload);
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
