import type { VoiceTalkMode } from "@openbot/ui/features/conversation/VoicePill";
import { createSignal } from "solid-js";

const VOICE_TALK_MODE_STORAGE_KEY = "openbot:voice-talk-mode";

let unsavedPreference: VoiceTalkMode | undefined;

function readVoiceTalkMode(): VoiceTalkMode {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(VOICE_TALK_MODE_STORAGE_KEY) === "open" ? "open" : "push";
  } catch {
    return "push";
  }
}

function writeVoiceTalkMode(mode: VoiceTalkMode): void {
  try {
    window.localStorage.setItem(VOICE_TALK_MODE_STORAGE_KEY, mode);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = mode;
  }
}

const [voiceTalkMode, setVoiceTalkModeSignal] = createSignal<VoiceTalkMode>(readVoiceTalkMode());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== VOICE_TALK_MODE_STORAGE_KEY) return;
  setVoiceTalkModeSignal(readVoiceTalkMode());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useVoiceTalkMode(): () => VoiceTalkMode {
  return voiceTalkMode;
}

export function setVoiceTalkMode(mode: VoiceTalkMode): void {
  writeVoiceTalkMode(mode);
  setVoiceTalkModeSignal(mode);
}
