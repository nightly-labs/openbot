// Frozen optional live-voice-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can chat with an
// agent of the host can talk to it by OpenAI realtime voice. The client makes the WebRTC offer of one
// audio track and the `oai-events` data channel, and sends it to the host. The host starts a separate
// Codex process with its own Codex sign-in, or the Codex account of the agent when the agent runs on
// Codex, and sends back the answer of OpenAI. Audio goes between the client and OpenAI; it never goes
// through the host. Each spoken request goes to the agent as the member's message, so the chat shows
// it as usual, and the agent's answer goes back to the voice.
//
// A member has at most one session; a new start ends the earlier one of that member. The host sends
// the transcript and the end of a session only to the connections of the member who started it, as
// the `live-voice` event. The host ends the session when that member stops it, or when the last event
// connection of the logical session that started it closes. An offer and an answer have at most
// 65,536 characters, a transcript part at most 100,000 and an end reason at most 4,000. The voice is
// one of the names below; an absent voice lets OpenAI choose. Widening any of it needs a second
// capability string.
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

/** The voices of this contract. A later Codex voice needs a second capability string. */
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

/** The request the host reads. The transport has already run it through the codec above. */
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

/** The answer of the host, as the client type. */
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

/** Null for any other event. A malformed live voice event throws, so the stream fails closed. */
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
