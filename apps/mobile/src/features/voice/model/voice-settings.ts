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

export type VoiceEngine = "supertonic" | "elevenlabs" | "voice-server";

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

export const TURN_PAUSE_LIMITS = { minimum: 1_000, maximum: 10_000, step: 500 } as const;

export function turnPauseMs(value: number): number {
  const { minimum, maximum, step } = TURN_PAUSE_LIMITS;
  return Math.min(maximum, Math.max(minimum, Math.round(value / step) * step));
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

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
  elevenLabsModel: ElevenLabsSpeechModelId;
  speed: SpeechSpeed;
  turnPauseMs: number;
  gptLive: boolean;
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
const ELEVENLABS_KEY = "openbot.mobile.elevenlabs-key.v1";

export const useVoiceSettings = create<VoiceSettings & { ready: boolean; hasElevenLabsKey: boolean }>(() => ({
  ...DEFAULT_SETTINGS,
  ready: false,
  hasElevenLabsKey: false,
}));

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
    if (!useVoiceSettings.getState().ready)
      useVoiceSettings.setState({ ...decodeSettings(settings), hasElevenLabsKey: Boolean(key) });
  } finally {
    useVoiceSettings.setState({ ready: true });
  }
}

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
