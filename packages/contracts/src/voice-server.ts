// The user's own OpenAI-compatible voice server, as the desktop and the phone read it: the model
// list of `GET /models`, the voice list, and the WAV audio of `POST /audio/speech`. The requests
// themselves stay in each app, because each has its own network and key storage.
import type { SpeechAudio, VoiceServerModels, VoiceServerRoutes } from "./ipc";
import { VOICE_SERVER_LIMITS } from "./ipc";
import { isDynamicRecord, isString } from "./runtime-values";

/**
 * The voices of the OpenAI speech API. A server that lists no voices gets these, because a server
 * that copies the OpenAI API usually accepts its voice names.
 */
export const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

/**
 * The voice lists to try, in order. There is no standard route: Kokoro-FastAPI answers
 * `/audio/voices` and Speaches `/audio/speech/voices`.
 */
export const VOICE_SERVER_VOICE_PATHS = ["audio/voices", "audio/speech/voices"] as const;

/** Model names that are speech recognition or speech synthesis, for a server that does not say. */
const TRANSCRIPTION_MODEL = /whisper|transcri|stt|asr|parakeet|scribe|canary|sensevoice|speech-to-text/i;
const SPEECH_MODEL = /tts|kokoro|piper|orpheus|xtts|kitten|chatterbox|melo|zonos|supertonic|text-to-speech/i;

/**
 * The models of a `GET /models` answer, sorted by route, or null when the answer is not a model list.
 * A model says its route in `task` on Speaches; for a server that does not, the name decides. A
 * model of neither kind, such as a chat model, is left out.
 */
export function voiceServerModelLists(body: unknown): { transcription: string[]; speech: string[] } | null {
  if (!isDynamicRecord(body) || !Array.isArray(body.data)) return null;
  const transcription: string[] = [];
  const speech: string[] = [];
  for (const entry of body.data) {
    if (!isDynamicRecord(entry) || !isString(entry.id)) continue;
    const id = entry.id.trim();
    if (!id || id.length > VOICE_SERVER_LIMITS.name) continue;
    const task = isString(entry.task) ? entry.task : "";
    const route =
      task === "automatic-speech-recognition"
        ? transcription
        : task === "text-to-speech"
          ? speech
          : TRANSCRIPTION_MODEL.test(id)
            ? transcription
            : SPEECH_MODEL.test(id)
              ? speech
              : null;
    if (route && !route.includes(id) && route.length < VOICE_SERVER_LIMITS.entries) route.push(id);
  }
  return { transcription, speech };
}

/** `["af_heart"]`, `{ voices: [...] }` or `{ data: [...] }`, with names or `{ id }`, `{ voice_id }`, `{ name }`. */
export function voiceServerVoiceNames(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : isDynamicRecord(body) && Array.isArray(body.voices)
      ? body.voices
      : isDynamicRecord(body) && Array.isArray(body.data)
        ? body.data
        : [];
  const names: string[] = [];
  for (const entry of list) {
    const name = isString(entry)
      ? entry
      : isDynamicRecord(entry)
        ? [entry.voice_id, entry.id, entry.name].find(isString)
        : undefined;
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length > VOICE_SERVER_LIMITS.name || names.includes(trimmed)) continue;
    names.push(trimmed);
    if (names.length >= VOICE_SERVER_LIMITS.entries) break;
  }
  return names;
}

/**
 * The routes that agree with what a test found. A route that the server does not have turns off; a
 * route that had no model yet turns on, so a new server is in use when its setup is done.
 */
export function fitVoiceServerRoutes(routes: VoiceServerRoutes, models: VoiceServerModels): VoiceServerRoutes {
  const known = (list: readonly string[], value: string | null) => (value && list.includes(value) ? value : null);
  const transcriptionModel = known(models.transcription, routes.transcriptionModel) ?? models.transcription[0] ?? null;
  const speechModel = known(models.speech, routes.speechModel) ?? models.speech[0] ?? null;
  const voice = known(models.voices, routes.voice) ?? models.voices[0] ?? null;
  const dictation =
    (routes.dictation || (!routes.transcriptionModel && models.transcription.length > 0)) && !!transcriptionModel;
  const speech = (routes.speech || (!routes.speechModel && models.speech.length > 0)) && !!speechModel && !!voice;
  return { dictation, speech, transcriptionModel, speechModel, voice };
}

/** The last part of a model ID, which is the part that a person reads. */
export function shortVoiceServerModel(model: string | null): string {
  if (!model) return "";
  return model.split("/").pop() || model;
}

/** `studio.local:8000` for `http://studio.local:8000/v1`, the part of an address that a message may name. */
export function voiceServerHost(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return "?";
  }
}

/**
 * The samples of a WAV file as 16-bit mono PCM. It takes 16-bit or 32-bit float samples, mixes
 * channels down, and reads a streamed file whose data size is unknown to its end.
 */
export function decodeVoiceServerWav(wav: Uint8Array): SpeechAudio | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
  if (wav.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = tag(offset);
    const declared = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && declared >= 16 && start + 16 <= wav.byteLength) {
      const code = view.getUint16(start, true);
      format = {
        // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID.
        code:
          code === 0xfffe && declared >= 26 && start + 26 <= wav.byteLength ? view.getUint16(start + 24, true) : code,
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === "data") {
      if (!format) return null;
      const end = declared === 0 || start + declared > wav.byteLength ? wav.byteLength : start + declared;
      return toMonoPcm16(view, start, end, format);
    }
    offset = start + declared + (declared % 2);
  }
  return null;
}

function toMonoPcm16(
  view: DataView,
  start: number,
  end: number,
  format: { code: number; channels: number; sampleRate: number; bits: number },
): SpeechAudio | null {
  const { code, channels, sampleRate, bits } = format;
  const pcm16 = code === 1 && bits === 16;
  const float32 = code === 3 && bits === 32;
  if ((!pcm16 && !float32) || channels < 1 || channels > 8 || sampleRate < 8_000 || sampleRate > 192_000) return null;
  const frameBytes = (bits / 8) * channels;
  const frames = Math.floor((end - start) / frameBytes);
  const output = new Uint8Array(frames * 2);
  const out = new DataView(output.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const at = start + frame * frameBytes + channel * (bits / 8);
      sum += pcm16 ? view.getInt16(at, true) / 32_768 : view.getFloat32(at, true);
    }
    const sample = Math.max(-1, Math.min(1, sum / channels));
    out.setInt16(frame * 2, Math.round(sample * 32_767), true);
  }
  return { pcm: output, sampleRate };
}

/** A WAV file of little-endian 16-bit mono PCM, for `POST /audio/transcriptions`. */
export function encodeVoiceServerWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) wav[offset + index] = value.charCodeAt(index);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, 44);
  return wav;
}
