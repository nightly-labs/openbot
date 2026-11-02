import {
  isSpeechLanguage,
  isSpeechVoice,
  isVoiceLanguage,
  isVoiceModelId,
  isVoiceServerRoutes,
  SPEECH_LIMITS,
  type SpeechInput,
  type SpeechSettings,
  VOICE_API_KEY_MAX_LENGTH,
  VOICE_AUDIO_LIMITS,
  VOICE_SERVER_LIMITS,
  VOICE_STREAM_LIMITS,
  type VoiceApiKeyInput,
  type VoiceModelRequest,
  type VoiceServerConnection,
  type VoiceServerSave,
  type VoiceSettings,
  type VoiceStream,
  type VoiceStreamAudio,
  type VoiceTranscriptionInput,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { parseBaseUrl } from "./custom-provider-inputs";
import { isObject } from "./validation";

export function parseVoiceTranscription(input: unknown): VoiceTranscriptionInput {
  if (!isObject(input) || !(input.audio instanceof Uint8Array)) {
    throw new Error("Voice audio is required.");
  }
  const audio = input.audio;
  if (audio.byteLength < 44 || audio.byteLength > VOICE_AUDIO_LIMITS.maximumWavBytes) {
    throw new Error("Voice audio has an invalid length.");
  }
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  if (
    ascii(audio, 0, 4) !== "RIFF" ||
    ascii(audio, 8, 12) !== "WAVE" ||
    ascii(audio, 12, 16) !== "fmt " ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== VOICE_AUDIO_LIMITS.channels ||
    view.getUint32(24, true) !== VOICE_AUDIO_LIMITS.sampleRate ||
    view.getUint16(34, true) !== VOICE_AUDIO_LIMITS.bitsPerSample ||
    ascii(audio, 36, 40) !== "data" ||
    view.getUint32(40, true) !== audio.byteLength - 44
  ) {
    throw new Error("Voice audio must be a 16 kHz mono PCM WAV file.");
  }
  return { audio };
}

/** The first bytes of an EBML file, such as WebM. */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/** A recording to keep is the Opus/WebM that the recorder wrote. Main stores it and does not decode it. */
export function parseVoiceRecording(input: unknown): VoiceTranscriptionInput {
  if (!isObject(input) || !(input.audio instanceof Uint8Array)) {
    throw new Error("Voice audio is required.");
  }
  const audio = input.audio;
  if (audio.byteLength <= EBML_MAGIC.length || audio.byteLength > VOICE_AUDIO_LIMITS.maximumRecordingBytes) {
    throw new Error("Voice audio has an invalid length.");
  }
  if (EBML_MAGIC.some((byte, index) => audio[index] !== byte)) {
    throw new Error("Voice audio must be a WebM file.");
  }
  return { audio };
}

function ascii(value: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...value.subarray(start, end));
}

export function parseVoiceModelRequest(input: unknown): VoiceModelRequest {
  if (!isObject(input) || !isVoiceModelId(input.modelId)) throw new Error("A known voice model is required.");
  return { modelId: input.modelId };
}

export function parseVoiceSettings(input: unknown): VoiceSettings {
  if (!isObject(input) || !isVoiceModelId(input.modelId) || !isVoiceLanguage(input.language)) {
    throw new Error("Voice settings need a known model and language.");
  }
  return { modelId: input.modelId, language: input.language };
}

/** The one place an ElevenLabs key from the renderer enters main. Null removes the saved key. */
export function parseVoiceApiKey(input: unknown): VoiceApiKeyInput {
  if (!isObject(input)) throw new Error(sourceText("error.provider.keyRequired"));
  if (input.key === null) return { key: null };
  if (typeof input.key !== "string" || !input.key.trim()) throw new Error(sourceText("error.provider.keyRequired"));
  if (input.key.length > VOICE_API_KEY_MAX_LENGTH) throw new Error(sourceText("error.provider.keyTooLong"));
  const key = input.key.trim();
  // The key goes into an HTTP header, which refuses other characters when the socket opens.
  if (!/^[\x21-\x7e]+$/u.test(key)) throw new Error(sourceText("error.provider.keyInvalidCharacters"));
  return { key };
}

export function parseVoiceStream(input: unknown): VoiceStream {
  if (!isObject(input) || typeof input.streamId !== "string" || !input.streamId || input.streamId.length > 64)
    throw new Error("A voice stream is required.");
  return { streamId: input.streamId };
}

export function parseVoiceStreamAudio(input: unknown): VoiceStreamAudio {
  const { streamId } = parseVoiceStream(input);
  if (!isObject(input) || !(input.pcm instanceof Uint8Array)) throw new Error("Voice audio is required.");
  // 16-bit samples: an odd length cannot be PCM.
  if (input.pcm.byteLength % 2 !== 0 || input.pcm.byteLength > VOICE_STREAM_LIMITS.maximumChunkBytes)
    throw new Error("Voice audio has an invalid length.");
  return { streamId, pcm: input.pcm };
}

export function parseSpeechSettings(input: unknown): SpeechSettings {
  if (!isObject(input) || typeof input.readReplies !== "boolean" || !isSpeechVoice(input.voice)) {
    throw new Error("Speech settings need a known voice.");
  }
  return { readReplies: input.readReplies, voice: input.voice };
}

export function parseSpeechInput(input: unknown): SpeechInput {
  if (!isObject(input) || typeof input.text !== "string" || !input.text.trim() || !isSpeechLanguage(input.language))
    throw new Error("Speech needs text and a known language.");
  if (input.text.length > SPEECH_LIMITS.maximumTextLength) throw new Error("The speech text is too long.");
  return { text: input.text, language: input.language };
}

/** The address and key of a voice server to test. The key can be a credential: no message quotes it. */
export function parseVoiceServerConnection(input: unknown): VoiceServerConnection {
  if (!isObject(input)) throw new Error("A voice server is required.");
  // The same rules as a custom provider's base URL: http or https, and no password in it.
  const address = parseBaseUrl(input.address);
  if (input.apiKey !== null && input.apiKey !== undefined && !isString(input.apiKey))
    throw new Error("The API key is not text.");
  const apiKey = isString(input.apiKey) ? input.apiKey.trim() || null : null;
  if (apiKey && apiKey.length > VOICE_SERVER_LIMITS.apiKey) throw new Error(sourceText("error.provider.apiKeyTooLong"));
  // The key goes into an HTTP header, which refuses other characters.
  if (apiKey && !/^[\x21-\x7e]+$/u.test(apiKey)) throw new Error(sourceText("error.provider.keyInvalidCharacters"));
  return { address, apiKey };
}

/** A server to save with its routes, or null to remove it. */
export function parseVoiceServerSave(input: unknown): VoiceServerSave {
  if (!isObject(input)) throw new Error("A voice server is required.");
  if (input.server === null) return { server: null };
  if (!isObject(input.server) || !isVoiceServerRoutes(input.server.routes))
    throw new Error("A voice server needs valid routes.");
  const { routes } = input.server;
  return {
    server: {
      ...parseVoiceServerConnection(input.server),
      routes: {
        dictation: routes.dictation,
        speech: routes.speech,
        transcriptionModel: routes.transcriptionModel,
        speechModel: routes.speechModel,
        voice: routes.voice,
      },
    },
  };
}
