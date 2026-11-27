import { isDynamicRecord, isOneOf, isString } from "../runtime-values";
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const LIVE_VOICE_CAPABILITY = "live-voice-v1";

export const LIVE_VOICE_ROUTES = {
  start: "/v1/live-voice/start",
  stop: "/v1/live-voice/stop",
} as const;

export const LIVE_VOICE_EVENT = "live-voice";

const SDP_LIMIT = 65_536;
export const LIVE_VOICE_TRANSCRIPT_LIMIT = 100_000;
export const LIVE_VOICE_REASON_LIMIT = 4_000;

const LIVE_VOICE_NAMES = [
  "juniper",
  "maple",
  "spruce",
  "ember",
  "vale",
  "breeze",
  "arbor",
  "sol",
  "cove",
  "aube",
  "bubbie",
  "haetsal",
  "hanul",
  "himari",
  "leher",
  "miko",
  "neer",
  "porto",
  "rindo",
  "rio",
  "rivage",
  "selva",
  "sonna",
  "tinta",
  "viola",
] as const;

export type LiveVoiceName = (typeof LIVE_VOICE_NAMES)[number];

export function isLiveVoiceName(value: unknown): value is LiveVoiceName {
  return isOneOf(LIVE_VOICE_NAMES, value);
}

export const LIVE_VOICE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    LIVE_VOICE_ROUTES.start,
    adminRoute(
      fields({ agentId: identifier, sdp: string(SDP_LIMIT) }, { voice: oneOf(...LIVE_VOICE_NAMES) }),
      fields({ sessionId: identifier, sdp: string(SDP_LIMIT) }),
    ),
  ],
  [LIVE_VOICE_ROUTES.stop, adminRoute(fields({ sessionId: identifier }), empty)],
]);

export interface LiveVoiceStartRequest {
  agentId: string;
  sdp: string;
  voice?: LiveVoiceName;
}

export interface LiveVoiceSessionResponse {
  sessionId: string;
  sdp: string;
}

export function decodeLiveVoiceStartRequest(value: unknown): LiveVoiceStartRequest {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isText(value.sdp, SDP_LIMIT))
    throw new Error("Invalid live voice start.");
  if (value.voice !== undefined && !isLiveVoiceName(value.voice)) throw new Error("Invalid live voice start.");
  return { agentId: value.agentId, sdp: value.sdp, ...(value.voice ? { voice: value.voice } : {}) };
}

export function decodeLiveVoiceStopRequest(value: unknown): string {
  if (!isDynamicRecord(value) || !isIdentifier(value.sessionId)) throw new Error("Invalid live voice stop.");
  return value.sessionId;
}

export function decodeLiveVoiceSessionResponse(value: unknown): LiveVoiceSessionResponse {
  if (!isDynamicRecord(value) || !isIdentifier(value.sessionId) || !isText(value.sdp, SDP_LIMIT))
    throw new Error("Invalid live voice session.");
  return { sessionId: value.sessionId, sdp: value.sdp };
}

export type LiveVoiceEvent =
  | {
      type: typeof LIVE_VOICE_EVENT;
      kind: "transcript";
      sessionId: string;
      role: "user" | "assistant";
      text: string;
      final: boolean;
    }
  | { type: typeof LIVE_VOICE_EVENT; kind: "ended"; sessionId: string; error: string | null };

export function liveVoiceEvent(value: unknown): LiveVoiceEvent | null {
  if (!isDynamicRecord(value) || value.type !== LIVE_VOICE_EVENT) return null;
  const { kind, sessionId } = value;
  if (!isIdentifier(sessionId)) throw new Error("Invalid live voice event.");
  if (kind === "transcript") {
    const { role, text, final } = value;
    if (
      (role !== "user" && role !== "assistant") ||
      !isText(text, LIVE_VOICE_TRANSCRIPT_LIMIT) ||
      typeof final !== "boolean"
    )
      throw new Error("Invalid live voice event.");
    return { type: LIVE_VOICE_EVENT, kind, sessionId, role, text, final };
  }
  if (kind === "ended") {
    const { error } = value;
    if (error !== null && !isText(error, LIVE_VOICE_REASON_LIMIT)) throw new Error("Invalid live voice event.");
    return { type: LIVE_VOICE_EVENT, kind, sessionId, error };
  }
  throw new Error("Invalid live voice event.");
}

function isIdentifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 128;
}

function isText(value: unknown, maximum: number): value is string {
  return isString(value) && value.length <= maximum;
}
