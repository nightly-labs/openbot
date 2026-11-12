import {
  type CloudSpeechModelId,
  type CodexLiveVoice,
  isCodexLiveVoice,
  isSpeechSpeed,
  isSpeechVoice,
  type SpeechSpeed,
  type SpeechVoice,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The voice that reads replies. Supertonic 3 runs on the phone, as on desktop; ElevenLabs reads
 * with the user's own key and sends the reply text to ElevenLabs; the voice server is the user's
 * own OpenAI-compatible server, as on desktop, and gets the reply text.
 */
export type VoiceEngine = "supertonic" | "elevenlabs" | "voice-server";

/**
 * What recognizes the user's speech. The phone's recognizer needs no download and hears one language;
 * Parakeet v3 runs on the phone and finds the language itself, as on desktop; Parakeet Unified runs on
 * the phone and hears English only; Qwen3-ASR runs on the phone, finds the language itself and hears
 * Chinese mixed with English; ElevenLabs Scribe finds the language too, with the user's own key, and
 * sends the audio to ElevenLabs; the voice server gets each recording, as on desktop. A version from
 * before an engine reads its saved name as the phone's recognizer.
 */
export type RecognitionEngine =
  | "system"
  | "parakeet"
  | "parakeet-unified"
  | "qwen3-asr"
  | "elevenlabs"
  | "voice-server";

const RECOGNITION_ENGINES: readonly RecognitionEngine[] = [
  "system",
  "parakeet",
  "parakeet-unified",
  "qwen3-asr",
  "elevenlabs",
  "voice-server",
];
const isRecognitionEngine = (value: unknown): value is RecognitionEngine =>
  RECOGNITION_ENGINES.some((engine) => engine === value);

/**
 * How long the user can stop saying new words in a voice conversation before the words so far are
 * sent, in milliseconds. A longer pause suits a slow speaker, or one who stops to think.
 */
export const TURN_PAUSE_LIMITS = { minimum: 1_000, maximum: 10_000, step: 500 } as const;

/** A stored pause outside the limits, or between two steps, goes to the nearest step. */
export function turnPauseMs(value: number): number {
  const { minimum, maximum, step } = TURN_PAUSE_LIMITS;
  return Math.min(maximum, Math.max(minimum, Math.round(value / step) * step));
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

/**
 * The ElevenLabs models that read replies, as on desktop, fastest first. Saved with the desktop
 * IDs of `CLOUD_SPEECH_MODELS`; never rename one.
 */
export const ELEVENLABS_SPEECH_MODEL_IDS = [
  "elevenlabs-flash-v2.5",
  "elevenlabs-multilingual-v2",
  "elevenlabs-v4-turbo",
  "elevenlabs-v4",
  "elevenlabs-v3",
] as const satisfies readonly CloudSpeechModelId[];
export type ElevenLabsSpeechModelId = (typeof ELEVENLABS_SPEECH_MODEL_IDS)[number];

interface VoiceSettings {
  engine: VoiceEngine;
  recognition: RecognitionEngine;
  supertonicVoice: SpeechVoice;
  elevenLabsVoice: ElevenLabsVoice | null;
  /** The ElevenLabs model that reads replies. Flash v2.5, the fastest, read every reply before the choice. */
  elevenLabsModel: ElevenLabsSpeechModelId;
  /** The speed of each reply that is read aloud, as on desktop. The pitch stays the same. */
  speed: SpeechSpeed;
  turnPauseMs: number;
  /**
   * A voice conversation in an agent chat uses GPT live voice when the server serves it. The call
   * goes between the phone and OpenAI, with the Codex sign-in of the computer that runs the server.
   */
  gptLive: boolean;
  /** The GPT live voice; null lets OpenAI choose. */
  gptLiveVoice: CodexLiveVoice | null;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  engine: "supertonic",
  recognition: "system",
  supertonicVoice: "F1",
  elevenLabsVoice: null,
  elevenLabsModel: "elevenlabs-flash-v2.5",
  speed: 1,
  turnPauseMs: 1_500,
  gptLive: false,
  gptLiveVoice: null,
};

const SETTINGS_KEY = "openbot.mobile.voice-settings.v1";
/** The key stays in the keychain only: no state, log or analytics event holds it. */
const ELEVENLABS_KEY = "openbot.mobile.elevenlabs-key.v1";

export const useVoiceSettings = create<VoiceSettings & { ready: boolean; hasElevenLabsKey: boolean }>(() => ({
  ...DEFAULT_SETTINGS,
  ready: false,
  hasElevenLabsKey: false,
}));

/** A stored value from an earlier version or a damaged entry falls back to the defaults, field by field. */
function decodeSettings(raw: string | null): VoiceSettings {
  if (!raw) return DEFAULT_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!isDynamicRecord(value)) return DEFAULT_SETTINGS;
  const voice = value.elevenLabsVoice;
  return {
    engine: value.engine === "elevenlabs" || value.engine === "voice-server" ? value.engine : "supertonic",
    recognition: isRecognitionEngine(value.recognition) ? value.recognition : DEFAULT_SETTINGS.recognition,
    supertonicVoice: isSpeechVoice(value.supertonicVoice) ? value.supertonicVoice : DEFAULT_SETTINGS.supertonicVoice,
    elevenLabsVoice:
      isDynamicRecord(voice) && isString(voice.id) && isString(voice.name) ? { id: voice.id, name: voice.name } : null,
    elevenLabsModel: isOneOf(ELEVENLABS_SPEECH_MODEL_IDS, value.elevenLabsModel)
      ? value.elevenLabsModel
      : DEFAULT_SETTINGS.elevenLabsModel,
    speed: isSpeechSpeed(value.speed) ? value.speed : DEFAULT_SETTINGS.speed,
    turnPauseMs:
      typeof value.turnPauseMs === "number" && Number.isFinite(value.turnPauseMs)
        ? turnPauseMs(value.turnPauseMs)
        : DEFAULT_SETTINGS.turnPauseMs,
    gptLive: value.gptLive === true,
    gptLiveVoice: isCodexLiveVoice(value.gptLiveVoice) ? value.gptLiveVoice : null,
  };
}

export async function loadVoiceSettings(): Promise<void> {
  if (useVoiceSettings.getState().ready) return;
  try {
    const [settings, key] = await Promise.all([
      SecureStore.getItemAsync(SETTINGS_KEY),
      SecureStore.getItemAsync(ELEVENLABS_KEY),
    ]);
    // A second startup read must not overwrite a change made in Settings.
    if (!useVoiceSettings.getState().ready)
      useVoiceSettings.setState({ ...decodeSettings(settings), hasElevenLabsKey: Boolean(key) });
  } finally {
    useVoiceSettings.setState({ ready: true });
  }
}

/** Applies at once, also when storage fails; the caller reports the failure. */
export async function saveVoiceSettings(change: Partial<VoiceSettings>): Promise<void> {
  const {
    engine,
    recognition,
    supertonicVoice,
    elevenLabsVoice,
    elevenLabsModel,
    speed,
    turnPauseMs,
    gptLive,
    gptLiveVoice,
  } = {
    ...useVoiceSettings.getState(),
    ...change,
  };
  const settings: VoiceSettings = {
    engine,
    recognition,
    supertonicVoice,
    elevenLabsVoice,
    elevenLabsModel,
    speed,
    turnPauseMs,
    gptLive,
    gptLiveVoice,
  };
  useVoiceSettings.setState(settings);
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
}

export function readElevenLabsKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ELEVENLABS_KEY);
}

export async function saveElevenLabsKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ELEVENLABS_KEY, key);
  useVoiceSettings.setState({ hasElevenLabsKey: true });
}

/**
 * Removes the key, and the ElevenLabs voice with it. Supertonic 3 reads again, and the phone's
 * recognizer listens again where ElevenLabs did.
 */
export async function removeElevenLabsKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ELEVENLABS_KEY);
  useVoiceSettings.setState({ hasElevenLabsKey: false });
  const { recognition } = useVoiceSettings.getState();
  await saveVoiceSettings({
    engine: "supertonic",
    elevenLabsVoice: null,
    recognition: recognition === "elevenlabs" ? "system" : recognition,
  });
}
