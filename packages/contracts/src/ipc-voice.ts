import { isBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const VOICE_AUDIO_LIMITS = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
  maximumSeconds: 120,
  maximumWavBytes: 3_840_044,
  /** A kept recording is Opus in WebM: 120 s at 32 kbps is about 480 KB, and the rest is room for VBR. */
  maximumRecordingBytes: 1_048_576,
} as const;

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
}

export interface VoiceTranscriptionResult {
  text: string;
}

/** The local speech recognition models. Saved in `voice-preference.json`; never rename one. */
export const LOCAL_VOICE_MODEL_IDS = ["parakeet-tdt-0.6b-v3", "bark-3.0-plus", "whisper-turbo"] as const;
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number];

/**
 * ElevenLabs Scribe v2 Realtime. Audio streams to ElevenLabs with the user's own API key, so it is
 * never the default. Saved in `voice-preference.json`; never rename it.
 */
export const ELEVENLABS_VOICE_MODEL_ID = "elevenlabs-scribe-v2-realtime";

/** Every dictation model, local ones first. */
export const VOICE_MODEL_IDS = [...LOCAL_VOICE_MODEL_IDS, ELEVENLABS_VOICE_MODEL_ID] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

interface VoiceModelCapabilities {
  /** The product name. It is not translated. */
  name: string;
  /**
   * True when the model takes a fixed language. Parakeet always finds the language itself, and Bark
   * recognizes English only.
   */
  supportsLanguage: boolean;
  /**
   * True when the composer shows text while you speak. Whisper reads 30 s for each pass, so it
   * transcribes only after Stop.
   */
  livePreview: boolean;
}

/** A model that runs on this computer after a download. */
export interface LocalVoiceModelInfo extends VoiceModelCapabilities {
  kind: "local";
  id: LocalVoiceModelId;
  /** The download size of all files. */
  bytes: number;
}

/** A model that runs at a provider. It is ready when its API key is saved. */
export interface CloudVoiceModelInfo extends VoiceModelCapabilities {
  kind: "cloud";
  id: typeof ELEVENLABS_VOICE_MODEL_ID;
}

export type VoiceModelInfo = LocalVoiceModelInfo | CloudVoiceModelInfo;

export const VOICE_MODELS: readonly VoiceModelInfo[] = [
  {
    kind: "local",
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    bytes: 670_478_772,
    supportsLanguage: false,
    livePreview: true,
  },
  {
    kind: "local",
    id: "bark-3.0-plus",
    name: "Underdog Bark 3.0 Plus",
    bytes: 684_624_267,
    supportsLanguage: false,
    livePreview: true,
  },
  {
    kind: "local",
    id: "whisper-turbo",
    name: "Whisper large-v3 turbo",
    bytes: 1_036_613_791,
    supportsLanguage: true,
    livePreview: false,
  },
  {
    kind: "cloud",
    id: ELEVENLABS_VOICE_MODEL_ID,
    name: "ElevenLabs Scribe v2 Realtime",
    supportsLanguage: true,
    livePreview: true,
  },
];

/** The model finds the spoken language itself. */
export const AUTOMATIC_VOICE_LANGUAGE = "automatic";

/**
 * The Whisper language codes that the settings offer. Each one has a `language.name.*` catalog
 * name; `jw` is Whisper's code for Javanese (`jv`). Automatic also finds the languages not listed.
 * ElevenLabs takes the same ISO 639 codes, with `jv` for `jw`.
 */
export const WHISPER_LANGUAGES = [
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fr",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jw",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "no",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "yue",
  "zh",
] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];
export type VoiceLanguage = typeof AUTOMATIC_VOICE_LANGUAGE | WhisperLanguage;

export interface VoiceSettings {
  modelId: VoiceModelId;
  /** Used only by a model that `supportsLanguage`. */
  language: VoiceLanguage;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  modelId: DEFAULT_VOICE_MODEL_ID,
  language: AUTOMATIC_VOICE_LANGUAGE,
};

export type VoiceModelPhase = "missing" | "downloading" | "ready" | "error";

export interface VoiceModelStatus {
  modelId: VoiceModelId;
  phase: VoiceModelPhase;
  progress: number | null;
  message: string | null;
}

export interface VoiceModelRequest {
  modelId: VoiceModelId;
}

/** The ElevenLabs API key, or null to remove it. Main never sends a saved key back. */
export interface VoiceApiKeyInput {
  key: string | null;
}

/** The longest API key main accepts, as for provider keys. */
export const VOICE_API_KEY_MAX_LENGTH = 512;

/**
 * One streamed dictation. The renderer sends the recording in parts while the user speaks;
 * `streamId` keeps the parts and the text of one recording apart from a later one.
 */
export interface VoiceStream {
  streamId: string;
}

/**
 * New audio of a stream: little-endian 16-bit mono PCM at 16 kHz that follows the audio sent
 * before. At most `VOICE_STREAM_LIMITS.maximumChunkBytes` in one part.
 */
export interface VoiceStreamAudio extends VoiceStream {
  pcm: Uint8Array;
}

export const VOICE_STREAM_LIMITS = {
  /** 5 s of audio. The renderer sends about every 250 ms. */
  maximumChunkBytes: 160_000,
} as const;

/** The text of a stream so far: the final segments and the segment the user still speaks. */
export interface VoiceStreamTranscript extends VoiceStream {
  text: string;
}

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return isOneOf(VOICE_MODEL_IDS, value);
}

export function isLocalVoiceModelId(value: unknown): value is LocalVoiceModelId {
  return isOneOf(LOCAL_VOICE_MODEL_IDS, value);
}

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === AUTOMATIC_VOICE_LANGUAGE || isOneOf(WHISPER_LANGUAGES, value);
}

/**
 * Supertonic 3, the local model that reads replies aloud. Saved in `speech-preference.json` and
 * named in model statuses; never rename it.
 */
export const SPEECH_MODEL_ID = "supertonic-3";
export type SpeechModelId = typeof SPEECH_MODEL_ID;

export const SPEECH_MODEL = {
  id: SPEECH_MODEL_ID,
  /** The product name. It is not translated. */
  name: "Supertonic 3",
  /** The download size of all files. */
  bytes: 145_296_838,
} as const;

/** The voice styles of Supertonic 3: five female and five male. Saved in `speech-preference.json`. */
export const SPEECH_VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

/** The languages Supertonic 3 reads. Each one has a `language.name.*` catalog name. */
export const SPEECH_LANGUAGES = [
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export interface SpeechSettings {
  /** Read the reply to a dictated message aloud. */
  readReplies: boolean;
  voice: SpeechVoice;
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = { readReplies: false, voice: "F1" };

export interface SpeechModelStatus extends Omit<VoiceModelStatus, "modelId"> {
  modelId: SpeechModelId;
}

export const SPEECH_LIMITS = {
  /** The longest text of one `speak` request. The renderer sends a reply in parts. */
  maximumTextLength: 1_000,
} as const;

/** One part of a reply to read aloud, in one language. */
export interface SpeechInput {
  text: string;
  language: SpeechLanguage;
}

/** The speech of one `SpeechInput`: little-endian 16-bit mono PCM. */
export interface SpeechAudio {
  pcm: Uint8Array;
  sampleRate: number;
}

export function isSpeechVoice(value: unknown): value is SpeechVoice {
  return isOneOf(SPEECH_VOICES, value);
}

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return isOneOf(SPEECH_LANGUAGES, value);
}

// ---------------------------------------------------------------------------------------------
// The user's own voice server: an OpenAI-compatible `/v1/audio` API on their network or online.

export const VOICE_SERVER_LIMITS = {
  address: 2_048,
  apiKey: 4_096,
  /** A model or voice name, such as `Systran/faster-whisper-large-v3`. */
  name: 256,
  /** The models or voices of one kind that a server lists. */
  entries: 500,
  message: 2_000,
} as const;

/**
 * What the server does for OpenBot. Dictation uses `POST /audio/transcriptions` and spoken replies
 * use `POST /audio/speech`. A route that is on has its model, and speech also has its voice.
 */
export interface VoiceServerRoutes {
  dictation: boolean;
  speech: boolean;
  transcriptionModel: string | null;
  speechModel: string | null;
  voice: string | null;
}

/** Main to renderer. The key never comes back; `hasApiKey` is all the renderer may know about it. */
export interface VoiceServerSettings {
  /** The base address of the API, such as `http://studio.local:8000/v1`. */
  address: string;
  hasApiKey: boolean;
  routes: VoiceServerRoutes;
}

/**
 * A server to test or to save. A null key keeps the saved key, but only when the address keeps the
 * saved origin, so an edited address never receives the old key.
 */
export interface VoiceServerConnection {
  address: string;
  apiKey: string | null;
}

export interface VoiceServerInput extends VoiceServerConnection {
  routes: VoiceServerRoutes;
}

/** Null removes the server, and dictation and spoken replies go back to this computer. */
export interface VoiceServerSave {
  server: VoiceServerInput | null;
}

/** What the server lists, by route. A list is empty when the server has nothing for that route. */
export interface VoiceServerModels {
  transcription: string[];
  speech: string[];
  voices: string[];
}

/** The form field that the user must change after a failed test. */
export type VoiceServerProbeField = "address" | "apiKey";

export type VoiceServerProbe =
  | { ok: true; models: VoiceServerModels }
  | { ok: false; field: VoiceServerProbeField; message: string };

function isNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= VOICE_SERVER_LIMITS.entries &&
    value.every((entry) => isBoundedString(entry, VOICE_SERVER_LIMITS.name) && entry.length > 0)
  );
}

function isOptionalName(value: unknown): value is string | null {
  return value === null || (isBoundedString(value, VOICE_SERVER_LIMITS.name) && value.length > 0);
}

/** A route that is on names its model, and spoken replies also name a voice. */
export function isVoiceServerRoutes(value: unknown): value is VoiceServerRoutes {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.dictation) &&
    isBoolean(value.speech) &&
    isOptionalName(value.transcriptionModel) &&
    isOptionalName(value.speechModel) &&
    isOptionalName(value.voice) &&
    (!value.dictation || value.transcriptionModel !== null) &&
    (!value.speech || (value.speechModel !== null && value.voice !== null))
  );
}

/** Fails closed like `isCustomProviderSummary`: a record that carries an `apiKey` is refused. */
export function isVoiceServerSettings(value: unknown): value is VoiceServerSettings {
  return (
    isDynamicRecord(value) &&
    !("apiKey" in value) &&
    isBoundedString(value.address, VOICE_SERVER_LIMITS.address) &&
    isBoolean(value.hasApiKey) &&
    isVoiceServerRoutes(value.routes)
  );
}

export function isVoiceServerProbe(value: unknown): value is VoiceServerProbe {
  if (!isDynamicRecord(value)) return false;
  if (value.ok === false)
    return (
      isOneOf<VoiceServerProbeField>(["address", "apiKey"], value.field) &&
      isBoundedString(value.message, VOICE_SERVER_LIMITS.message)
    );
  const models = value.models;
  return (
    value.ok === true &&
    isDynamicRecord(models) &&
    isNameList(models.transcription) &&
    isNameList(models.speech) &&
    isNameList(models.voices)
  );
}
