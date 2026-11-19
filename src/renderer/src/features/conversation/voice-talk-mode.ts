import type { VoiceTalkMode } from "@openbot/ui/features/conversation/VoicePill";
import { createSignal } from "solid-js";

const VOICE_TALK_MODE_STORAGE_KEY = "openbot:voice-talk-mode";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: VoiceTalkMode | undefined;

/**
 * How the user talks in a voice conversation on this device and browser: push to talk unless the
 * user chose the open microphone. Reading `window.localStorage` throws when the browser blocks
 * storage, so it is read inside the guard.
 */
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
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = mode;
  }
}

const [voiceTalkMode, setVoiceTalkModeSignal] = createSignal<VoiceTalkMode>(readVoiceTalkMode());

/** A choice in another window of this app or browser reaches this page. */
function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== VOICE_TALK_MODE_STORAGE_KEY) return;
  setVoiceTalkModeSignal(readVoiceTalkMode());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: the pill of each chat follows it. */
export function useVoiceTalkMode(): () => VoiceTalkMode {
  return voiceTalkMode;
}

export function setVoiceTalkMode(mode: VoiceTalkMode): void {
  writeVoiceTalkMode(mode);
  setVoiceTalkModeSignal(mode);
}
