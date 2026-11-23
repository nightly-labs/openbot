// Frozen optional voice-transcription-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can have
// the host turn a short recording into text, with the speech recognition that the host has (Settings →
// Voice on the host: its own voice server, a model on the host, or Groq with the host's key). The member
// sends the recording as the raw body of `POST /v1/voice/transcribe`: a WAV file of 16 kHz mono 16-bit
// PCM, at most `VOICE_AUDIO_LIMITS.maximumWavBytes` (120 seconds). The host answers `{ text }`. The text
// goes to no agent; the client puts it in its composer. When the model of the host is not on the host,
// the request starts its download and answers 409 with a sentence; any other refusal that the member can
// act on is also 409 with a sentence. The host keeps no recording. Widening any of it needs a second
// capability string.
import { INPUT_LIMITS } from "../input-limits";
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const VOICE_TRANSCRIPTION_CAPABILITY = "voice-transcription-v1";

export const VOICE_TRANSCRIPTION_ROUTES = {
  transcribe: "/v1/voice/transcribe",
} as const;

export const VOICE_TRANSCRIPTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  // The request body is the raw WAV file, so its decoder never reads it.
  [VOICE_TRANSCRIPTION_ROUTES.transcribe, adminRoute(empty, fields({ text: string(INPUT_LIMITS.messageText) }))],
]);

/** The answer of the host, as the client type. */
export function decodeVoiceTranscription(value: unknown): { text: string } {
  if (!isDynamicRecord(value) || !isString(value.text) || value.text.length > INPUT_LIMITS.messageText)
    throw new Error("Invalid voice transcription.");
  return { text: value.text };
}
