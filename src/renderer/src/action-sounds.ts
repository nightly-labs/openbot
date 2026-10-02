import { SOUND_THEMES, type SoundChoice, type SoundTheme } from "@openbot/ui/features/settings/app-settings";
import { bind, type PlayOptions, play, type SoundName, setEnabled, setTheme } from "cuelume";

const ACTION_SOUNDS_STORAGE_KEY = "openbot:action-sounds-enabled";
const ACTION_SOUNDS_THEME_STORAGE_KEY = "openbot:action-sounds-theme";

type PreferenceStorage = Pick<Storage, "getItem">;

/** The choices for this page after the browser did not save them. They win over older saved values. */
let unsavedPreference: boolean | undefined;
let unsavedTheme: SoundTheme | undefined;
let started = false;

/**
 * The sounds are off until the user turns them on: an update must not start new sounds. Reading
 * `window.localStorage` throws when the browser blocks storage, so it is read inside the guard.
 */
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

/** The sound picker value: "off", or the saved theme. */
export function readActionSoundChoice(): SoundChoice {
  return isActionSoundEnabled() ? readActionSoundTheme() : "off";
}

/** Returns false when blocked or full storage keeps the choice for this page only. */
function savePreference(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a sound picker choice and plays it. "off" keeps the theme, so the next time the user turns
 * the sounds on, the picker shows the theme from before.
 */
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
  // The picker's own click is skipped while the sounds are off, and it does not name a theme, so the
  // preview plays here.
  play("success", { theme: choice });
}

/** Plays the preview of the selected theme again. "Off" stays silent. */
export function replayActionSoundChoice(choice: SoundChoice): void {
  if (choice !== "off") play("success", { theme: choice });
}

function applySavedChoice(): void {
  setTheme(readActionSoundTheme());
  setEnabled(isActionSoundEnabled());
}

/**
 * Plays the cues that shared controls name in their `data-cuelume-*` attributes, and follows a change
 * that another tab saves. Later calls do nothing.
 */
export function startActionSounds(): void {
  if (started) return;
  started = true;
  applySavedChoice();
  window.addEventListener("storage", (event) => {
    if (event.key === ACTION_SOUNDS_STORAGE_KEY || event.key === ACTION_SOUNDS_THEME_STORAGE_KEY) applySavedChoice();
  });
  bind();
}

/**
 * Plays a cue for an action that no control click reports, such as a reply that failed. It reads the
 * saved choice, so a page that did not call `startActionSounds`, such as a story, stays silent.
 */
export function playActionSound(sound: SoundName, options?: PlayOptions): void {
  if (isActionSoundEnabled()) play(sound, options);
}
