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
export const LOCAL_VOICE_MODEL_IDS = [
  "parakeet-tdt-0.6b-v3",
  "parakeet-unified-en-0.6b",
  "bark-3.0-plus",
  "whisper-turbo",
  "cohere-transcribe-03-2026",
] as const;
export type LocalVoiceModelId = (typeof LOCAL_VOICE_MODEL_IDS)[number];

/**
 * ElevenLabs Scribe v2 Realtime. Audio streams to ElevenLabs with the user's own API key, so it is
 * never the default. Saved in `voice-preference.json`; never rename it.
 */
export const ELEVENLABS_VOICE_MODEL_ID = "elevenlabs-scribe-v2-realtime";

/**
 * Whisper at Groq. The whole recording goes to Groq after Stop, with the user's own API key, so
 * neither is the default. Saved in `voice-preference.json`; never rename one.
 */
export const GROQ_VOICE_MODEL_IDS = ["groq-whisper-large-v3-turbo", "groq-whisper-large-v3"] as const;
export type GroqVoiceModelId = (typeof GROQ_VOICE_MODEL_IDS)[number];

/** The dictation models that run at a provider. */
export type CloudVoiceModelId = typeof ELEVENLABS_VOICE_MODEL_ID | GroqVoiceModelId;

/** Every dictation model, local ones first. */
export const VOICE_MODEL_IDS = [...LOCAL_VOICE_MODEL_IDS, ELEVENLABS_VOICE_MODEL_ID, ...GROQ_VOICE_MODEL_IDS] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

interface VoiceModelCapabilities {
  /** The product name. It is not translated. */
  name: string;
  /**
   * True when the model takes a fixed language. Parakeet TDT always finds the language itself, and
   * Parakeet Unified and Bark recognize English only.
   */
  supportsLanguage: boolean;
  /**
   * The only languages the model takes, when it cannot find the language itself. Without this
   * list, a model that `supportsLanguage` takes every Whisper language and automatic.
   */
  languages?: readonly WhisperLanguage[];
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
  /**
   * Not offered any more. A saved choice still works, and the settings show the model only while it
   * is in use or downloaded, so that the user can remove its files.
   */
  retired?: true;
}

/**
 * A model that runs at a provider. It is ready when its provider's API key is saved. ElevenLabs
 * takes a stream while the user speaks; Groq takes the whole recording after Stop.
 */
export interface CloudVoiceModelInfo extends VoiceModelCapabilities {
  kind: "cloud";
  id: CloudVoiceModelId;
  provider: DictationKeyProvider;
}

export type VoiceModelInfo = LocalVoiceModelInfo | CloudVoiceModelInfo;

/** The languages of Cohere Transcribe. It does not find the language itself. */
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
    // Parakeet Unified EN is as fast, with punctuation and fewer errors.
    retired: true,
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
    kind: "local",
    id: "cohere-transcribe-03-2026",
    name: "Cohere Transcribe",
    bytes: 2_888_052_036,
    supportsLanguage: true,
    languages: COHERE_TRANSCRIBE_LANGUAGES,
    // A decode takes about three times as long as Parakeet, too long to repeat while you speak.
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

/** The 25 European languages that Parakeet TDT v3 finds. It cannot write any other language. */
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

/** BCP 47 language codes that Whisper writes in another way. */
const WHISPER_LANGUAGE_ALIASES: Readonly<Record<string, WhisperLanguage>> = { nb: "no", nn: "no", iw: "he", jv: "jw" };

/**
 * The dictation settings before the user chooses a model, from the language they use (a BCP 47 tag
 * such as `ko-KR`). Parakeet stays the default for its own languages and for an unknown language.
 * Another language that Whisper knows gets Whisper turbo: Parakeet would write it as wrong words.
 * Whisper finds the spoken language itself, so speech in a second language stays correct.
 */
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

/** The API key of a dictation provider, or null to remove it. Main never sends a saved key back. */
export interface VoiceApiKeyInput {
  provider: DictationKeyProvider;
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

export function isGroqVoiceModelId(value: unknown): value is GroqVoiceModelId {
  return isOneOf(GROQ_VOICE_MODEL_IDS, value);
}

export function isDictationKeyProvider(value: unknown): value is DictationKeyProvider {
  return isOneOf(DICTATION_KEY_PROVIDERS, value);
}

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === AUTOMATIC_VOICE_LANGUAGE || isOneOf(WHISPER_LANGUAGES, value);
}

/**
 * The language that a model with its own `languages` uses: the saved language when the model
 * takes it, else English. A model without the list uses the saved language.
 */
export function modelLanguage(model: VoiceModelInfo, language: VoiceLanguage): VoiceLanguage {
  const languages = model.languages;
  if (!languages) return language;
  return languages.find((candidate) => candidate === language) ?? "en";
}

/**
 * Supertonic 3, the local model that reads replies aloud. Saved in `speech-preference.json` and
 * named in model statuses; never rename it.
 */
export const SPEECH_MODEL_ID = "supertonic-3";
export type LocalSpeechModelId = typeof SPEECH_MODEL_ID;

/** The providers that read replies aloud with the user's own API key. */
export const SPEECH_KEY_PROVIDERS = ["elevenlabs", "xai"] as const;
export type SpeechKeyProvider = (typeof SPEECH_KEY_PROVIDERS)[number];

/** The providers that transcribe dictation with the user's own API key. ElevenLabs has one key for both routes. */
export const DICTATION_KEY_PROVIDERS = ["elevenlabs", "groq"] as const;
export type DictationKeyProvider = (typeof DICTATION_KEY_PROVIDERS)[number];

/** Each provider whose API key the Voice settings keep. */
export type VoiceKeyProvider = SpeechKeyProvider | DictationKeyProvider;

/** The product names of the providers. They are not translated. */
export const VOICE_KEY_PROVIDER_NAMES: Record<VoiceKeyProvider, string> = {
  elevenlabs: "ElevenLabs",
  xai: "xAI",
  groq: "Groq",
};

/**
 * The models that read replies aloud at a provider. The reply text goes to the provider with the
 * user's own API key, so none is the default. Saved in `speech-preference.json`; never rename one.
 */
export const CLOUD_SPEECH_MODEL_IDS = [
  "elevenlabs-flash-v2.5",
  "elevenlabs-multilingual-v2",
  "elevenlabs-v4-turbo",
  "elevenlabs-v4",
  "elevenlabs-v3",
  "xai-tts",
] as const;
export type CloudSpeechModelId = (typeof CLOUD_SPEECH_MODEL_IDS)[number];

/** Every model that reads replies aloud, Supertonic first. */
export const SPEECH_MODEL_IDS = [SPEECH_MODEL_ID, ...CLOUD_SPEECH_MODEL_IDS] as const;
export type SpeechModelId = (typeof SPEECH_MODEL_IDS)[number];

export interface CloudSpeechModelInfo {
  id: CloudSpeechModelId;
  provider: SpeechKeyProvider;
  /** The product name. It is not translated. */
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

/** The cloud model of an ID, or undefined for Supertonic. */
export function cloudSpeechModel(id: SpeechModelId): CloudSpeechModelInfo | undefined {
  return CLOUD_SPEECH_MODELS.find((model) => model.id === id);
}

/** ElevenLabs default voices. The main process maps each name to its voice ID. Saved in `speech-preference.json`. */
export const ELEVENLABS_SPEECH_VOICES = ["alice", "chris", "eric", "george", "jessica", "sarah"] as const;
export type ElevenLabsSpeechVoice = (typeof ELEVENLABS_SPEECH_VOICES)[number];

/** xAI voices. Each name is also the voice ID. Saved in `speech-preference.json`. */
export const XAI_SPEECH_VOICES = ["eve", "ara", "leo", "rex", "sal"] as const;
export type XaiSpeechVoice = (typeof XAI_SPEECH_VOICES)[number];

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

/** The speeds of a reply that is read aloud, slowest first. 1 is normal speed. */
export const SPEECH_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type SpeechSpeed = (typeof SPEECH_SPEEDS)[number];

/** The order in which a speed button goes through the speeds: from normal speed up, then the slower ones. */
const SPEECH_SPEED_CYCLE: readonly SpeechSpeed[] = [
  ...SPEECH_SPEEDS.filter((speed) => speed >= 1),
  ...SPEECH_SPEEDS.filter((speed) => speed < 1),
];

/** The speed after `speed` on a speed button: 1×, 1.25×, 1.5×, 2×, 0.75×, then 1× again. */
export function nextSpeechSpeed(speed: number): SpeechSpeed {
  const index = SPEECH_SPEED_CYCLE.findIndex((step) => step === speed);
  return SPEECH_SPEED_CYCLE[(index + 1) % SPEECH_SPEED_CYCLE.length] ?? 1;
}

export interface SpeechSettings {
  /** Read the reply to a dictated message aloud. */
  readReplies: boolean;
  /** The model that reads replies aloud. */
  modelId: SpeechModelId;
  /** The Supertonic voice. */
  voice: SpeechVoice;
  elevenLabsVoice: ElevenLabsSpeechVoice;
  xaiVoice: XaiSpeechVoice;
  /** The speed of each reply that is read aloud. The pitch stays the same. */
  speed: SpeechSpeed;
  /**
   * A voice conversation with any agent on this computer uses Codex live voice: the Codex App Server
   * connects the microphone to OpenAI's realtime model with the user's own Codex sign-in, and gives
   * each spoken request to the agent's own provider.
   */
  codexLive: boolean;
  /** The voice of Codex live voice. Null lets OpenAI choose. */
  codexLiveVoice: CodexLiveVoice | null;
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
};

/**
 * The realtime v3 voices that Codex App Server's `realtime/listVoices` gives for a ChatGPT sign-in.
 * Its list has no default v3 voice. The names are the voices' own names, in every language.
 */
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

/**
 * The start of a Codex live voice session. `sdp` is the WebRTC offer of the renderer's peer
 * connection: one audio track and the `oai-events` data channel.
 */
export interface VoiceLiveStart {
  agentId: string;
  sdp: string;
}

/** A live voice session that runs. `sdp` is the answer to the offer of `VoiceLiveStart`. */
export interface VoiceLiveSession {
  sessionId: string;
  sdp: string;
}

export interface VoiceLiveStop {
  sessionId: string;
}

/**
 * What a live voice session sends while it runs. A transcript part with `final: false` is new text
 * of the part that is spoken now; `final: true` gives the whole part. `ended` is the last event of a
 * session; `error` is null when the user or the app ended it.
 */
export type VoiceLiveEvent =
  | { type: "transcript"; sessionId: string; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "ended"; sessionId: string; error: string | null };

export const VOICE_LIVE_LIMITS = {
  /** A WebRTC offer of one audio track and one data channel is a few kilobytes. */
  maximumSdpLength: 65_536,
} as const;

export interface SpeechModelStatus extends Omit<VoiceModelStatus, "modelId"> {
  modelId: SpeechModelId;
}

/** An API key for a provider that reads replies aloud. Null removes the saved key. */
export interface SpeechApiKeyInput {
  provider: SpeechKeyProvider;
  key: string | null;
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
