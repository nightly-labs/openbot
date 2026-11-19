import {
  defaultTalkKey,
  type KeyLayout,
  parseTalkKey,
  sameTalkKey,
  serializeTalkKey,
  type TalkKey,
  type TalkKeyBinding,
  type TalkKeyPlatform,
} from "@openbot/ui/features/conversation/talk-key";
import { createSignal } from "solid-js";
import { currentDevicePlatform } from "../../send-shortcut-preference";

const VOICE_TALK_KEY_STORAGE_KEY = "openbot:voice-talk-key";

/**
 * The choice for this page after the browser did not save it. It wins over an older saved value. Null
 * is the default key of the platform.
 */
let unsavedPreference: TalkKey | null | undefined;

/**
 * The push to talk key that the user chose on this device and browser, or null for the default of the
 * platform. Reading `window.localStorage` throws when the browser blocks storage, so it is read inside
 * the guard.
 */
function readVoiceTalkKey(): TalkKey | null {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return parseTalkKey(window.localStorage.getItem(VOICE_TALK_KEY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeVoiceTalkKey(key: TalkKey | null): void {
  try {
    if (key) window.localStorage.setItem(VOICE_TALK_KEY_STORAGE_KEY, serializeTalkKey(key));
    else window.localStorage.removeItem(VOICE_TALK_KEY_STORAGE_KEY);
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = key;
  }
}

const [savedTalkKey, setSavedTalkKey] = createSignal<TalkKey | null>(readVoiceTalkKey());
const [keyLayout, setKeyLayout] = createSignal<KeyLayout | undefined>(undefined);
let layoutAsked = false;

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== VOICE_TALK_KEY_STORAGE_KEY) return;
  setSavedTalkKey(readVoiceTalkKey());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/**
 * The characters of the user's keyboard layout, so that a chord with a letter shows the letter of the
 * key cap, such as "A" for `KeyQ` on a French keyboard. Only Chromium has the Keyboard API; the other
 * browsers show the caps of a US keyboard.
 */
function askKeyLayout(): void {
  if (layoutAsked || !("keyboard" in navigator)) return;
  layoutAsked = true;
  const keyboard = navigator.keyboard;
  if (typeof keyboard !== "object" || keyboard === null || !("getLayoutMap" in keyboard)) return;
  const getLayoutMap = keyboard.getLayoutMap;
  if (typeof getLayoutMap !== "function") return;
  Promise.resolve(getLayoutMap.call(keyboard))
    .then((map: unknown) => {
      if (typeof map !== "object" || map === null || !("get" in map)) return;
      const get = map.get;
      if (typeof get !== "function") return;
      setKeyLayout(() => (code: string) => {
        const character = get.call(map, code);
        return typeof character === "string" && character.length > 0 ? character : undefined;
      });
    })
    .catch(() => undefined);
}

/**
 * The push to talk key of this page, and what its label needs. Desktop call sites pass the host
 * platform, which is the device with the keyboard there; web call sites leave it empty and the browser
 * is detected.
 */
export function useVoiceTalkKey(appPlatform?: () => TalkKeyPlatform | undefined): () => TalkKeyBinding {
  askKeyLayout();
  return () => {
    const platform = appPlatform?.() ?? currentDevicePlatform();
    return { key: savedTalkKey() ?? defaultTalkKey(platform), platform, layout: keyLayout() };
  };
}

/** Saves the key. The default key of the platform, or null, saves nothing, so a new default reaches the user. */
export function setVoiceTalkKey(key: TalkKey | null, platform: TalkKeyPlatform): void {
  const saved = key && !sameTalkKey(key, defaultTalkKey(platform)) ? key : null;
  writeVoiceTalkKey(saved);
  setSavedTalkKey(saved);
}
