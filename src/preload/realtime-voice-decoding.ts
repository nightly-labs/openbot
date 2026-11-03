import type { RealtimeVoicePoll } from "@openbot/contracts/ipc";
import {
  isRealtimeVoiceIdentifier,
  REALTIME_VOICE_SDP_LIMIT,
  type RealtimeVoiceAnswer,
  type RealtimeVoiceSettings,
  type RealtimeVoiceStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export function decodeRealtimeVoiceStatusFromMain(value: unknown): RealtimeVoiceStatus {
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
    throw new Error("Invalid live voice status from main.");
  return { enabled: value.enabled, model: value.model, voice: value.voice };
}
export function decodeRealtimeVoiceAnswerFromMain(value: unknown): RealtimeVoiceAnswer {
  if (
    !isDynamicRecord(value) ||
    typeof value.sdp !== "string" ||
    !value.sdp.startsWith("v=0") ||
    value.sdp.length > REALTIME_VOICE_SDP_LIMIT
  )
    throw new Error("Invalid live voice answer from main.");
  if (value.sessionId !== undefined && !isRealtimeVoiceIdentifier(value.sessionId))
    throw new Error("Invalid live voice session.");
  return { sdp: value.sdp, ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}) };
}

export function decodeRealtimeVoicePollFromMain(value: unknown): RealtimeVoicePoll {
  if (!isDynamicRecord(value) || typeof value.active !== "boolean") throw new Error("Invalid live voice state.");
  if (value.delegation === null) return { active: value.active, delegation: null };
  const item = value.delegation;
  if (
    !isDynamicRecord(item) ||
    !isRealtimeVoiceIdentifier(item.id) ||
    typeof item.request !== "string" ||
    item.request.length > 16_000
  )
    throw new Error("Invalid live voice delegation.");
  return { active: value.active, delegation: { id: item.id, request: item.request } };
}

export function decodeRealtimeVoiceSettingsFromMain(value: unknown): RealtimeVoiceSettings {
  if (
    !isDynamicRecord(value) ||
    typeof value.configured !== "boolean" ||
    typeof value.canManage !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.model !== "string" ||
    !value.model.length ||
    value.model.length > 128 ||
    typeof value.defaultVoice !== "string" ||
    !value.defaultVoice.length ||
    value.defaultVoice.length > 128 ||
    (value.voice !== null && (typeof value.voice !== "string" || !value.voice.length || value.voice.length > 128))
  )
    throw new Error("Invalid live voice settings from Main.");
  return {
    configured: value.configured,
    canManage: value.canManage,
    enabled: value.enabled,
    model: value.model,
    defaultVoice: value.defaultVoice,
    voice: value.voice,
  };
}
