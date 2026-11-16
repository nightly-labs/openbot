import { createSignal } from "solid-js";

const DICTATION_KEY_STORAGE_KEY = "openbot:dictation-key";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * Whether the dictation key works on this device and browser. It is off unless the user turned it on,
 * because a key that opens the microphone must not surprise anyone. Reading `window.localStorage`
 * throws when the browser blocks storage, so it is read inside the guard.
 */
function readDictationKey(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(DICTATION_KEY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeDictationKey(enabled: boolean): void {
  try {
    window.localStorage.setItem(DICTATION_KEY_STORAGE_KEY, String(enabled));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = enabled;
  }
}

const [dictationKey, setDictationKeySignal] = createSignal(readDictationKey());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== DICTATION_KEY_STORAGE_KEY) return;
  setDictationKeySignal(readDictationKey());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches the open chat at once. */
export function useDictationKey(): () => boolean {
  return dictationKey;
}

export function setDictationKey(enabled: boolean): void {
  writeDictationKey(enabled);
  setDictationKeySignal(enabled);
}

/**
 * The `KeyboardEvent.code` of the dictation key. Right Option on macOS. Right Ctrl elsewhere, because
 * on Windows the right Alt key is AltGr, which types characters.
 */
export function dictationKeyCode(platform: "darwin" | "win32" | "linux"): "AltRight" | "ControlRight" {
  return platform === "darwin" ? "AltRight" : "ControlRight";
}
