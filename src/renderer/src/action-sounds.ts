import { SOUND_THEMES, type SoundChoice, type SoundTheme } from "@openbot/ui/features/settings/app-settings";
import { bind, type PlayOptions, play, type SoundName, setEnabled, setTheme } from "cuelume";

const ACTION_SOUNDS_STORAGE_KEY = "openbot:action-sounds-enabled";
const ACTION_SOUNDS_THEME_STORAGE_KEY = "openbot:action-sounds-theme";

type PreferenceStorage = Pick<Storage, "getItem">;

let unsavedPreference: boolean | undefined;
let unsavedTheme: SoundTheme | undefined;
let started = false;

export function isActionSoundEnabled(storage?: PreferenceStorage): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return (storage ?? window.localStorage).getItem(ACTION_SOUNDS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function readActionSoundTheme(storage?: PreferenceStorage): SoundTheme {
  if (unsavedTheme !== undefined) return unsavedTheme;
  try {
    const saved = (storage ?? window.localStorage).getItem(ACTION_SOUNDS_THEME_STORAGE_KEY);
    return SOUND_THEMES.find((theme) => theme === saved) ?? "default";
  } catch {
    return "default";
  }
}

export function readActionSoundChoice(): SoundChoice {
  return isActionSoundEnabled() ? readActionSoundTheme() : "off";
}

function savePreference(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function setActionSoundChoice(choice: SoundChoice): void {
  const enabled = choice !== "off";
  unsavedPreference = savePreference(ACTION_SOUNDS_STORAGE_KEY, String(enabled)) ? undefined : enabled;
  if (!enabled) {
    play("close");
    setEnabled(false);
    return;
  }
  unsavedTheme = savePreference(ACTION_SOUNDS_THEME_STORAGE_KEY, choice) ? undefined : choice;
  setEnabled(true);
  setTheme(choice);
  play("success", { theme: choice });
}

function applySavedChoice(): void {
  setTheme(readActionSoundTheme());
  setEnabled(isActionSoundEnabled());
}

export function startActionSounds(): void {
  if (started) return;
  started = true;
  applySavedChoice();
  window.addEventListener("storage", (event) => {
    if (event.key === ACTION_SOUNDS_STORAGE_KEY || event.key === ACTION_SOUNDS_THEME_STORAGE_KEY) applySavedChoice();
  });
  bind();
}

export function playActionSound(sound: SoundName, options?: PlayOptions): void {
  if (isActionSoundEnabled()) play(sound, options);
}
