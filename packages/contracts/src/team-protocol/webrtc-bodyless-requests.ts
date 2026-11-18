import { isDynamicRecord } from "../runtime-values";
import { isAgentAnalyticsRoute, isHostAnalyticsRoute } from "./current";
import { decodeScopedUsageRequest, scopedUsageRoute } from "./current-adapter-routes";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "./webrtc-framing";

/**
 * The WebRTC request frame of a route that has no request body: a GET, a DELETE, the routine test POST
 * and the remote viewer routes. Protocols 4 to 10 send this frame. Before plan 011 item 2 they called the
 * v3 WebRTC codec for it, so the rules here are the rules of that codec, and the bytes do not change:
 *
 * - The analytics, host analytics and model-scoped usage GETs carry an empty object.
 * - A remote viewer route carries its value as it is, and an empty value as `{}`.
 * - A route in the frozen no-body list carries `{}` when the value is empty.
 * - Each other value is refused with the v1 codec's error.
 *
 * Encoding and decoding give the same result, because the frame has no vocabulary to translate.
 */
export function teamWebRtcBodylessRequest(method: string, path: string, value: unknown): TeamProtocolV2Json {
  if (isAgentAnalyticsRoute(method, path) || isHostAnalyticsRoute(method, path) || scopedUsageRoute(method, path))
    return wireJson(decodeScopedUsageRequest(value ?? {}));
  const normalized = value === undefined ? null : wireJson(value);
  if (isTeamWebRtcRemoteViewerRoute(path)) return isEmptyRequest(normalized) ? {} : normalized;
  if (isEmptyRequest(normalized) && isTeamWebRtcNoBodyRoute(method, path)) return {};
  throw new Error("Invalid Team protocol v1 HTTP request.");
}

/** The response of a remote viewer route goes on the wire as it is. */
export function teamWebRtcRemoteViewerResponse(value: unknown): TeamProtocolV2Json {
  return wireJson(value === undefined ? null : value);
}

/** A route whose WebRTC request frame {@link teamWebRtcBodylessRequest} makes. */
export function isTeamWebRtcBodylessRoute(method: string, path: string): boolean {
  return (
    method === "GET" || method === "DELETE" || isRoutineTestRequest(method, path) || isTeamWebRtcRemoteViewerRoute(path)
  );
}

export function isTeamWebRtcRemoteViewerRoute(path: string): boolean {
  return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/(?:viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/u.test(
    new URL(path, "http://openbot.invalid").pathname,
  );
}

/**
 * The frozen no-body route list of protocol 2. A route added after it cannot join the list, because a
 * released host reads the list to accept a frame. A newer bodyless route has its own codec.
 */
export function isTeamWebRtcNoBodyRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (method === "GET") {
    if (
      new Set([
        "/v1/compatibility",
        "/v1/identity",
        "/v1/me",
        "/v1/team/presence",
        "/v1/remote-screen/capabilities",
        "/v1/direct/threads",
        "/v1/messages/search",
        "/v1/browser/tabs",
        "/v1/browser/control",
        "/v1/team/members",
        "/v1/team/invites",
        "/v1/team/sessions",
        "/v1/agents/status",
        "/v1/sidebar-layout",
        "/v1/agents/usage",
        "/v1/agents/models",
        "/v1/agents",
        "/v1/agents/conversation-reads",
      ]).has(pathname)
    ) {
      return true;
    }
    if (
      /^\/v1\/attachments\/[^/]+$/u.test(pathname) ||
      pathname === "/v1/shared-files" ||
      pathname === "/v1/workspace-files" ||
      isTeamWebRtcRemoteViewerRoute(pathname)
    ) {
      return true;
    }
    if (/^\/v1\/direct\/conversations\/[^/]+(?:\/page)?$/u.test(pathname)) return true;
    return /^\/v1\/agents\/[^/]+\/(?:avatar|skills|memories|routines|routines\/[^/]+\/runs|conversation|conversation-page|queue)$/u.test(
      pathname,
    );
  }
  if (method === "POST" && /^\/v1\/agents\/[^/]+\/routines\/[^/]+\/test$/u.test(pathname)) return true;
  if (method !== "DELETE") return false;
  return (
    /^\/v1\/attachments\/[^/]+$/u.test(pathname) ||
    /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+$/u.test(pathname) ||
    /^\/v1\/agents\/[^/]+$/u.test(pathname) ||
    /^\/v1\/agents\/[^/]+\/avatar$/u.test(pathname) ||
    /^\/v1\/agents\/[^/]+\/memories(?:\/[^/]+)?$/u.test(pathname) ||
    /^\/v1\/agents\/[^/]+\/routines\/[^/]+$/u.test(pathname)
  );
}

function isRoutineTestRequest(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/v1\/agents\/[^/]+\/routines\/[^/]+\/test$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

function isEmptyRequest(value: unknown): boolean {
  return value === null || (isDynamicRecord(value) && Object.keys(value).length === 0);
}

function wireJson(value: unknown): TeamProtocolV2Json {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("The Team protocol value is not serializable.");
  return decodeTeamProtocolV2Json(JSON.parse(encoded));
}
