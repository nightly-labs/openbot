import { INPUT_LIMITS } from "../input-limits";
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const VOICE_TRANSCRIPTION_CAPABILITY = "voice-transcription-v1";

export const VOICE_TRANSCRIPTION_ROUTES = {
  transcribe: "/v1/voice/transcribe",
} as const;

export const VOICE_TRANSCRIPTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [VOICE_TRANSCRIPTION_ROUTES.transcribe, adminRoute(empty, fields({ text: string(INPUT_LIMITS.messageText) }))],
]);

export function decodeVoiceTranscription(value: unknown): { text: string } {
  if (!isDynamicRecord(value) || !isString(value.text) || value.text.length > INPUT_LIMITS.messageText)
    throw new Error("Invalid voice transcription.");
  return { text: value.text };
}
