import { isBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const VOICE_AUDIO_LIMITS = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
  maximumSeconds: 600,
  maximumWavBytes: 19_200_044,
  maximumRecordingBytes: 1_048_576,
} as const;

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
}

export interface VoiceTranscriptionResult {
  text: string;
}

export const LOCAL_VOICE_MODEL_IDS = [
  "parakeet-tdt-0.6b-v3",
  "parakeet-unified-en-0.6b",
  "bark-3.0-plus",
  "whisper-turbo",
  "cohere-transcribe-03-2026",
] as const;
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number];

export const ELEVENLABS_VOICE_MODEL_ID = "elevenlabs-scribe-v2-realtime";

export const GROQ_VOICE_MODEL_IDS = ["groq-whisper-large-v3-turbo", "groq-whisper-large-v3"] as const;
export type GroqVoiceModelId = (typeof GROQ_VOICE_MODEL_IDS)[number];

export type CloudVoiceModelId = typeof ELEVENLABS_VOICE_MODEL_ID | GroqVoiceModelId;

export const VOICE_MODEL_IDS = [...LOCAL_VOICE_MODEL_IDS, ELEVENLABS_VOICE_MODEL_ID, ...GROQ_VOICE_MODEL_IDS] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

interface VoiceModelCapabilities {
  name: string;
  supportsLanguage: boolean;
  languages?: readonly WhisperLanguage[];
  livePreview: boolean;
}

export interface LocalVoiceModelInfo extends VoiceModelCapabilities {
  kind: "local";
  id: LocalVoiceModelId;
  bytes: number;
  retired?: true;
}

export interface CloudVoiceModelInfo extends VoiceModelCapabilities {
  kind: "cloud";
  id: CloudVoiceModelId;
  provider: DictationKeyProvider;
}

export type VoiceModelInfo = LocalVoiceModelInfo | CloudVoiceModelInfo;

const COHERE_TRANSCRIBE_LANGUAGES = [
  "ar",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "vi",
  "zh",
] as const satisfies readonly WhisperLanguage[];

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
    id: "parakeet-unified-en-0.6b",
    name: "Parakeet Unified EN 0.6B",
    bytes: 663_043_117,
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
    retired: true,
  },
  {
    kind: "local",
    id: "whisper-turbo",
    name: "Whisper large-v3 turbo",
    bytes: 1_311_742_559,
    supportsLanguage: true,
    livePreview: false,
  },
  {
    kind: "local",
    id: "cohere-transcribe-03-2026",
    name: "Cohere Transcribe",
    bytes: 2_888_052_036,
    supportsLanguage: true,
    languages: COHERE_TRANSCRIBE_LANGUAGES,
    livePreview: false,
  },
  {
    kind: "cloud",
    id: ELEVENLABS_VOICE_MODEL_ID,
    provider: "elevenlabs",
    name: "ElevenLabs Scribe v2 Realtime",
    supportsLanguage: true,
    livePreview: true,
  },
  {
    kind: "cloud",
    id: "groq-whisper-large-v3-turbo",
    provider: "groq",
    name: "Groq Whisper large-v3 turbo",
    supportsLanguage: true,
    livePreview: false,
  },
  {
    kind: "cloud",
    id: "groq-whisper-large-v3",
    provider: "groq",
    name: "Groq Whisper large-v3",
    supportsLanguage: true,
    livePreview: false,
  },
];

export const AUTOMATIC_VOICE_LANGUAGE = "automatic";

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
  language: VoiceLanguage;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  modelId: DEFAULT_VOICE_MODEL_ID,
  language: AUTOMATIC_VOICE_LANGUAGE,
};

const PARAKEET_TDT_LANGUAGES = [
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
  "hr",
  "hu",
  "it",
  "lt",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "uk",
] as const satisfies readonly WhisperLanguage[];

const WHISPER_LANGUAGE_ALIASES: Readonly<Record<string, WhisperLanguage>> = { nb: "no", nn: "no", iw: "he", jv: "jw" };

export function defaultVoiceSettings(locale: string): VoiceSettings {
  const code = locale.toLowerCase().split(/[-_]/u)[0] ?? "";
  const language = WHISPER_LANGUAGE_ALIASES[code] ?? code;
  if (!isOneOf(WHISPER_LANGUAGES, language) || isOneOf(PARAKEET_TDT_LANGUAGES, language)) return DEFAULT_VOICE_SETTINGS;
  return { modelId: "whisper-turbo", language: AUTOMATIC_VOICE_LANGUAGE };
}

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

export interface VoiceApiKeyInput {
  provider: DictationKeyProvider;
  key: string | null;
}

export const VOICE_API_KEY_MAX_LENGTH = 512;

export interface VoiceStream {
  streamId: string;
}

export interface VoiceStreamAudio extends VoiceStream {
  pcm: Uint8Array;
}

export const VOICE_STREAM_LIMITS = {
  maximumChunkBytes: 160_000,
} as const;

export interface VoiceStreamTranscript extends VoiceStream {
  text: string;
}

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return isOneOf(VOICE_MODEL_IDS, value);
}

export function isLocalVoiceModelId(value: unknown): value is LocalVoiceModelId {
  return isOneOf(LOCAL_VOICE_MODEL_IDS, value);
}

export function isGroqVoiceModelId(value: unknown): value is GroqVoiceModelId {
  return isOneOf(GROQ_VOICE_MODEL_IDS, value);
}

export function isDictationKeyProvider(value: unknown): value is DictationKeyProvider {
  return isOneOf(DICTATION_KEY_PROVIDERS, value);
}

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === AUTOMATIC_VOICE_LANGUAGE || isOneOf(WHISPER_LANGUAGES, value);
}

export function modelLanguage(model: VoiceModelInfo, language: VoiceLanguage): VoiceLanguage {
  const languages = model.languages;
  if (!languages) return language;
  return languages.find((candidate) => candidate === language) ?? "en";
}

export const SPEECH_MODEL_ID = "supertonic-3";
export type LocalSpeechModelId = typeof SPEECH_MODEL_ID;

export const SPEECH_KEY_PROVIDERS = ["elevenlabs", "xai"] as const;
export type SpeechKeyProvider = (typeof SPEECH_KEY_PROVIDERS)[number];

export const DICTATION_KEY_PROVIDERS = ["elevenlabs", "groq"] as const;
export type DictationKeyProvider = (typeof DICTATION_KEY_PROVIDERS)[number];

export type VoiceKeyProvider = SpeechKeyProvider | DictationKeyProvider;

export const VOICE_KEY_PROVIDER_NAMES: Record<VoiceKeyProvider, string> = {
  elevenlabs: "ElevenLabs",
  xai: "xAI",
  groq: "Groq",
};

export const CLOUD_SPEECH_MODEL_IDS = [
  "elevenlabs-flash-v2.5",
  "elevenlabs-multilingual-v2",
  "elevenlabs-v4-turbo",
  "elevenlabs-v4",
  "elevenlabs-v3",
  "xai-tts",
] as const;
export type CloudSpeechModelId = (typeof CLOUD_SPEECH_MODEL_IDS)[number];

export const SPEECH_MODEL_IDS = [SPEECH_MODEL_ID, ...CLOUD_SPEECH_MODEL_IDS] as const;
export type SpeechModelId = (typeof SPEECH_MODEL_IDS)[number];

export interface CloudSpeechModelInfo {
  id: CloudSpeechModelId;
  provider: SpeechKeyProvider;
  name: string;
}

export const CLOUD_SPEECH_MODELS: readonly CloudSpeechModelInfo[] = [
  { id: "elevenlabs-flash-v2.5", provider: "elevenlabs", name: "Flash v2.5" },
  { id: "elevenlabs-multilingual-v2", provider: "elevenlabs", name: "Multilingual v2" },
  { id: "elevenlabs-v4-turbo", provider: "elevenlabs", name: "Eleven v4 Turbo" },
  { id: "elevenlabs-v4", provider: "elevenlabs", name: "Eleven v4" },
  { id: "elevenlabs-v3", provider: "elevenlabs", name: "Eleven v3" },
  { id: "xai-tts", provider: "xai", name: "Text to Speech" },
];

export function cloudSpeechModel(id: SpeechModelId): CloudSpeechModelInfo | undefined {
  return CLOUD_SPEECH_MODELS.find((model) => model.id === id);
}

export const ELEVENLABS_SPEECH_VOICES = ["alice", "chris", "eric", "george", "jessica", "sarah"] as const;
export type ElevenLabsSpeechVoice = (typeof ELEVENLABS_SPEECH_VOICES)[number];

export const XAI_SPEECH_VOICES = ["eve", "ara", "leo", "rex", "sal"] as const;
export type XaiSpeechVoice = (typeof XAI_SPEECH_VOICES)[number];

export const SPEECH_MODEL = {
  id: SPEECH_MODEL_ID,
  name: "Supertonic 3",
  bytes: 145_296_838,
} as const;

export const SPEECH_VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

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

export const SPEECH_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type SpeechSpeed = (typeof SPEECH_SPEEDS)[number];

export const VOICE_TURN_PAUSES = [1_500, 2_000, 3_000, 5_000] as const;
export type VoiceTurnPause = (typeof VOICE_TURN_PAUSES)[number];

const SPEECH_SPEED_CYCLE: readonly SpeechSpeed[] = [
  ...SPEECH_SPEEDS.filter((speed) => speed >= 1),
  ...SPEECH_SPEEDS.filter((speed) => speed < 1),
];

export function nextSpeechSpeed(speed: number): SpeechSpeed {
  const index = SPEECH_SPEED_CYCLE.findIndex((step) => step === speed);
  return SPEECH_SPEED_CYCLE[(index + 1) % SPEECH_SPEED_CYCLE.length] ?? 1;
}

export interface SpeechSettings {
  readReplies: boolean;
  modelId: SpeechModelId;
  voice: SpeechVoice;
  elevenLabsVoice: ElevenLabsSpeechVoice;
  xaiVoice: XaiSpeechVoice;
  speed: SpeechSpeed;
  codexLive: boolean;
  codexLiveVoice: CodexLiveVoice | null;
  turnPauseMs: VoiceTurnPause;
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  readReplies: false,
  modelId: SPEECH_MODEL_ID,
  voice: "F1",
  elevenLabsVoice: "alice",
  xaiVoice: "eve",
  speed: 1,
  codexLive: false,
  codexLiveVoice: null,
  turnPauseMs: VOICE_TURN_PAUSES[0],
};

export const CODEX_LIVE_VOICES = [
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
export type CodexLiveVoice = (typeof CODEX_LIVE_VOICES)[number];

export interface VoiceLiveStart {
  agentId: string;
  sdp: string;
}

export interface VoiceLiveSession {
  sessionId: string;
  sdp: string;
}

export interface VoiceLiveStop {
  sessionId: string;
}

export type VoiceLiveEvent =
  | { type: "transcript"; sessionId: string; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "ended"; sessionId: string; error: string | null };

export const VOICE_LIVE_LIMITS = {
  maximumSdpLength: 65_536,
} as const;

export interface SpeechModelStatus extends Omit<VoiceModelStatus, "modelId"> {
  modelId: SpeechModelId;
}

export interface SpeechApiKeyInput {
  provider: SpeechKeyProvider;
  key: string | null;
}

export const SPEECH_LIMITS = {
  maximumTextLength: 1_000,
} as const;

export interface SpeechInput {
  text: string;
  language: SpeechLanguage;
}

export interface SpeechAudio {
  pcm: Uint8Array;
  sampleRate: number;
}

export function isSpeechVoice(value: unknown): value is SpeechVoice {
  return isOneOf(SPEECH_VOICES, value);
}

export function isSpeechModelId(value: unknown): value is SpeechModelId {
  return isOneOf(SPEECH_MODEL_IDS, value);
}

export function isSpeechKeyProvider(value: unknown): value is SpeechKeyProvider {
  return isOneOf(SPEECH_KEY_PROVIDERS, value);
}

export function isElevenLabsSpeechVoice(value: unknown): value is ElevenLabsSpeechVoice {
  return isOneOf(ELEVENLABS_SPEECH_VOICES, value);
}

export function isXaiSpeechVoice(value: unknown): value is XaiSpeechVoice {
  return isOneOf(XAI_SPEECH_VOICES, value);
}

export function isCodexLiveVoice(value: unknown): value is CodexLiveVoice {
  return isOneOf(CODEX_LIVE_VOICES, value);
}

export function isSpeechSpeed(value: unknown): value is SpeechSpeed {
  return isOneOf(SPEECH_SPEEDS, value);
}

export function isVoiceTurnPause(value: unknown): value is VoiceTurnPause {
  return isOneOf(VOICE_TURN_PAUSES, value);
}

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return isOneOf(SPEECH_LANGUAGES, value);
}

export const VOICE_SERVER_LIMITS = {
  address: 2_048,
  apiKey: 4_096,
  name: 256,
  entries: 500,
  message: 2_000,
} as const;

export interface VoiceServerRoutes {
  dictation: boolean;
  speech: boolean;
  transcriptionModel: string | null;
  speechModel: string | null;
  voice: string | null;
}

export interface VoiceServerSettings {
  address: string;
  hasApiKey: boolean;
  routes: VoiceServerRoutes;
}

export interface VoiceServerConnection {
  address: string;
  apiKey: string | null;
}

export interface VoiceServerInput extends VoiceServerConnection {
  routes: VoiceServerRoutes;
}

export interface VoiceServerSave {
  server: VoiceServerInput | null;
}

export interface VoiceServerModels {
  transcription: string[];
  speech: string[];
  voices: string[];
}

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
