import type { GeneralSettingsValue, SoundChoice } from "@openbot/ui/features/settings/app-settings";
import { play } from "cuelume";
import { createSignal } from "solid-js";
import type { SoundFeedbackChoice } from "../src/features/settings/sound-feedback";

/** Plays the preview that the app plays for a new sound choice, without saving the choice. */
export function previewStorySoundChoice(choice: SoundChoice): void {
  if (choice === "off") play("close");
  else play("success", { theme: choice });
}

/** Plays the preview when a settings change picks a new sound choice. */
export function previewStorySoundSettings(previous: GeneralSettingsValue, next: GeneralSettingsValue): void {
  if (previous.soundFeedback === next.soundFeedback && previous.soundTheme === next.soundTheme) return;
  previewStorySoundChoice(next.soundFeedback ? next.soundTheme : "off");
}

/** A sound feedback choice for this story only. A new choice plays its preview, as the app does. */
export function createStorySoundFeedback(initial: SoundChoice = "default"): SoundFeedbackChoice {
  const [value, setValue] = createSignal(initial);
  return {
    get value() {
      return value();
    },
    onChange(next) {
      setValue(next);
      previewStorySoundChoice(next);
    },
  };
}
