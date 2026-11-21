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

let unsavedPreference: TalkKey | null | undefined;

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
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

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

export function useVoiceTalkKey(appPlatform?: () => TalkKeyPlatform | undefined): () => TalkKeyBinding {
  askKeyLayout();
  return () => {
    const platform = appPlatform?.() ?? currentDevicePlatform();
    return { key: savedTalkKey() ?? defaultTalkKey(platform), platform, layout: keyLayout() };
  };
}

export function setVoiceTalkKey(key: TalkKey | null, platform: TalkKeyPlatform): void {
  const saved = key && !sameTalkKey(key, defaultTalkKey(platform)) ? key : null;
  writeVoiceTalkKey(saved);
  setSavedTalkKey(saved);
}

export function useKeyLayout(): () => KeyLayout | undefined {
  askKeyLayout();
  return keyLayout;
}
