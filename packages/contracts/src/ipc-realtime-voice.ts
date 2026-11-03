import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/** Subscription GPT-Live names; API Realtime has a separate voice set. */
export const SUBSCRIPTION_REALTIME_VOICES = [
  "arbor",
  "breeze",
  "cove",
  "ember",
  "juniper",
  "maple",
  "sol",
  "spruce",
  "vale",
] as const;
export const API_REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
export function realtimeVoiceChoices(model: string): readonly string[] {
  return model === "gpt-live-1-codex" ? SUBSCRIPTION_REALTIME_VOICES : API_REALTIME_VOICES;
}

export interface RealtimeVoiceEnabled {
  enabled: boolean;
}
export function parseRealtimeVoiceEnabled(value: unknown): RealtimeVoiceEnabled {
  if (!isDynamicRecord(value) || typeof value.enabled !== "boolean") throw new Error("Invalid live voice setting.");
  return { enabled: value.enabled };
}

export interface RealtimeVoiceStatus {
  enabled: boolean;
  model: string;
  voice: string;
}
export interface RealtimeVoiceOffer {
  agentId: string;
  sdp: string;
}
export interface RealtimeVoiceAnswer {
  sdp: string;
  sessionId?: string;
}
export interface RealtimeVoiceCall {
  agentId: string;
  sessionId: string;
}
export interface RealtimeVoiceReply extends RealtimeVoiceCall {
  delegationId: string;
  text: string | null;
}
export interface RealtimeVoicePoll {
  active: boolean;
  delegation: { id: string; request: string } | null;
}
export const REALTIME_VOICE_SDP_LIMIT = 65_536;
export const DISABLED_REALTIME_VOICE: RealtimeVoiceStatus = { enabled: false, model: "gpt-realtime", voice: "marin" };

export function isRealtimeVoiceIdentifier(value: unknown): value is string {
  return isIdentifier(value);
}

function sdp(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= REALTIME_VOICE_SDP_LIMIT && value.startsWith("v=0")
  );
}
export function parseRealtimeVoiceOffer(value: unknown): RealtimeVoiceOffer {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !sdp(value.sdp))
    throw new Error("Invalid live voice offer.");
  return { agentId: value.agentId, sdp: value.sdp };
}
export function parseRealtimeVoiceStatus(value: unknown): RealtimeVoiceStatus {
  if (
    !isDynamicRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.model !== "string" ||
    !value.model.length ||
    value.model.length > 128 ||
    typeof value.voice !== "string" ||
    !value.voice.length ||
    value.voice.length > 128
  )
    throw new Error("Invalid live voice status.");
  return { enabled: value.enabled, model: value.model, voice: value.voice };
}
export function parseRealtimeVoiceAnswer(value: unknown): RealtimeVoiceAnswer {
  if (!isDynamicRecord(value) || !sdp(value.sdp) || (value.sessionId !== undefined && !isIdentifier(value.sessionId)))
    throw new Error("Invalid live voice answer.");
  return { sdp: value.sdp, ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}) };
}

export function parseRealtimeVoiceCall(value: unknown): RealtimeVoiceCall {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isIdentifier(value.sessionId))
    throw new Error("Invalid live voice call.");
  return { agentId: value.agentId, sessionId: value.sessionId };
}
export function parseRealtimeVoiceReply(value: unknown): RealtimeVoiceReply {
  const call = parseRealtimeVoiceCall(value);
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.delegationId) ||
    (value.text !== null && (typeof value.text !== "string" || value.text.length > 16_000))
  )
    throw new Error("Invalid live voice reply.");
  return { ...call, delegationId: value.delegationId, text: value.text };
}
export function parseRealtimeVoicePoll(value: unknown): RealtimeVoicePoll {
  if (!isDynamicRecord(value) || typeof value.active !== "boolean") throw new Error("Invalid live voice poll.");
  if (value.delegation === null) return { active: value.active, delegation: null };
  const item = value.delegation;
  if (
    !isDynamicRecord(item) ||
    !isIdentifier(item.id) ||
    typeof item.request !== "string" ||
    item.request.length > 16_000
  )
    throw new Error("Invalid live voice delegation.");
  return { active: value.active, delegation: { id: item.id, request: item.request } };
}
