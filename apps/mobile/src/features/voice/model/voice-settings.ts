import { isSpeechVoice, type SpeechVoice } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The voice that reads replies. Supertonic 3 runs on the phone, as on desktop; ElevenLabs reads
 * with the user's own key and sends the reply text to ElevenLabs.
 */
export type VoiceEngine = "supertonic" | "elevenlabs";

/**
 * What recognizes the user's speech. The phone's recognizer needs no download and hears one language;
 * Parakeet runs on the phone and finds the language itself, as on desktop; ElevenLabs Scribe finds it
 * too, with the user's own key, and sends the audio to ElevenLabs.
 */
export type RecognitionEngine = "system" | "parakeet" | "elevenlabs";

const RECOGNITION_ENGINES: readonly RecognitionEngine[] = ["system", "parakeet", "elevenlabs"];
const isRecognitionEngine = (value: unknown): value is RecognitionEngine =>
  RECOGNITION_ENGINES.some((engine) => engine === value);

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

interface VoiceSettings {
  engine: VoiceEngine;
  recognition: RecognitionEngine;
  supertonicVoice: SpeechVoice;
  elevenLabsVoice: ElevenLabsVoice | null;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  engine: "supertonic",
  recognition: "system",
  supertonicVoice: "F1",
  elevenLabsVoice: null,
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
    engine: value.engine === "elevenlabs" ? "elevenlabs" : "supertonic",
    recognition: isRecognitionEngine(value.recognition) ? value.recognition : DEFAULT_SETTINGS.recognition,
    supertonicVoice: isSpeechVoice(value.supertonicVoice) ? value.supertonicVoice : DEFAULT_SETTINGS.supertonicVoice,
    elevenLabsVoice:
      isDynamicRecord(voice) && isString(voice.id) && isString(voice.name) ? { id: voice.id, name: voice.name } : null,
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
  const { engine, recognition, supertonicVoice, elevenLabsVoice } = { ...useVoiceSettings.getState(), ...change };
  useVoiceSettings.setState({ engine, recognition, supertonicVoice, elevenLabsVoice });
  await SecureStore.setItemAsync(
    SETTINGS_KEY,
    JSON.stringify({ engine, recognition, supertonicVoice, elevenLabsVoice }),
  );
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
