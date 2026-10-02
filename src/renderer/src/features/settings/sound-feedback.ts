import type { SoundChoice } from "@openbot/ui/features/settings/app-settings";

/** The saved sound feedback choice, as the onboarding step shows it: off, or on in one sound theme. */
export interface SoundFeedbackChoice {
  value: SoundChoice;
  onChange: (value: SoundChoice) => void;
}
