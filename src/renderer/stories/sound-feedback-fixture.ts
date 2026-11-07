import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { play } from "cuelume";
import { playSoundChoice } from "../src/completion-sound";

/** Plays the preview that the app plays for a new sound choice, without saving the choice. */
export function previewStorySoundSettings(previous: GeneralSettingsValue, next: GeneralSettingsValue): void {
  if (previous.taskSound !== next.taskSound) playSoundChoice(next.taskSound);
  if (previous.soundFeedback === next.soundFeedback && previous.soundTheme === next.soundTheme) return;
  if (next.soundFeedback) playSoundChoice(next.soundTheme);
  else play("close");
}
