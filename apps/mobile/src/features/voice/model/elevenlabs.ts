import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { ElevenLabsSpeechModelId, ElevenLabsVoice } from "./voice-settings";

const API = "https://api.elevenlabs.io";
const SPEECH_MODELS: Record<ElevenLabsSpeechModelId, string> = {
  "elevenlabs-flash-v2.5": "eleven_flash_v2_5",
  "elevenlabs-multilingual-v2": "eleven_multilingual_v2",
  "elevenlabs-v3": "eleven_v3",
  "elevenlabs-v4-turbo": "eleven_v4_turbo",
  "elevenlabs-v4": "eleven_v4",
};
export const ELEVENLABS_SAMPLE_RATE = 24_000;

type ElevenLabsPermission = "voices_read" | "text_to_speech" | "speech_to_text";

const MISSING_PERMISSION = {
  voices_read: "missing-voices-permission",
  text_to_speech: "missing-speech-permission",
  speech_to_text: "missing-transcription-permission",
} as const;

type ElevenLabsFailure = "invalid-key" | (typeof MISSING_PERMISSION)[ElevenLabsPermission] | "network" | "failed";

const REASON_MAX_LENGTH = 300;

export class ElevenLabsError extends Error {
  constructor(
    readonly code: ElevenLabsFailure,
    readonly reason: string | null = null,
  ) {
    super(code);
  }
}

function errorDetail(body: string, key: string): { status: string | null; reason: string | null } {
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    return { status: null, reason: null };
  }
  const detail = isDynamicRecord(answer) ? answer.detail : null;
  const status = isDynamicRecord(detail) && isString(detail.status) ? detail.status : null;
  const message = isString(detail) ? detail : isDynamicRecord(detail) && isString(detail.message) ? detail.message : "";
  const reason = (key ? message.replaceAll(key, "…") : message).trim().slice(0, REASON_MAX_LENGTH);
  return { status, reason: reason || null };
}

async function request(
  path: string,
  key: string,
  permission: ElevenLabsPermission,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers: { ...init.headers, "xi-api-key": key } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ElevenLabsError("network");
  }
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  const { status, reason } = errorDetail(body, key);
  if (response.status === 401 || response.status === 403) {
    if (body.includes("missing_permissions") || body.includes(permission))
      throw new ElevenLabsError(MISSING_PERMISSION[permission]);
    if (status === "invalid_api_key" || !reason) throw new ElevenLabsError("invalid-key");
  }
  throw new ElevenLabsError("failed", reason);
}

export async function listElevenLabsVoices(key: string): Promise<ElevenLabsVoice[]> {
  const response = await request("/v2/voices?page_size=100", key, "voices_read");
  const body = await response.json().catch(() => null);
  if (!isDynamicRecord(body) || !Array.isArray(body.voices)) throw new ElevenLabsError("failed");
  return body.voices.flatMap((voice) =>
    isDynamicRecord(voice) && isString(voice.voice_id) && isString(voice.name)
      ? [{ id: voice.voice_id, name: voice.name }]
      : [],
  );
}

export async function elevenLabsSpeech(
  key: string,
  voiceId: string,
  model: ElevenLabsSpeechModelId,
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await request(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${ELEVENLABS_SAMPLE_RATE}`,
    key,
    "text_to_speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: SPEECH_MODELS[model] }),
      signal,
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

export async function scribeToken(key: string, signal: AbortSignal): Promise<string> {
  const response = await request("/v1/single-use-token/realtime_scribe", key, "speech_to_text", {
    method: "POST",
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!isDynamicRecord(body) || !isString(body.token)) throw new ElevenLabsError("failed");
  return body.token;
}

export async function testElevenLabsKey(key: string): Promise<ElevenLabsVoice[]> {
  const voices = await listElevenLabsVoices(key);
  const first = voices[0];
  if (first) await elevenLabsSpeech(key, first.id, "elevenlabs-flash-v2.5", ".", new AbortController().signal);
  return voices;
}

export function elevenLabsVoiceParts(name: string): { title: string; description: string | null } {
  const at = name.indexOf(" - ");
  return at > 0 ? { title: name.slice(0, at), description: name.slice(at + 3) } : { title: name, description: null };
}
