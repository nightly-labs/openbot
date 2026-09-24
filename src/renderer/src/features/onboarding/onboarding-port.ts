import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What onboarding reaches in main: the saved setup, and the preview of an invite before the user
 * joins.
 */
export interface OnboardingPort {
  getSetupState: OpenBotDesktopApi["getSetupState"];
  saveSetup: OpenBotDesktopApi["saveSetup"];
  servers: Pick<OpenBotDesktopApi["servers"], "previewInvite">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function onboardingPort(): OnboardingPort {
  return window.openbot;
}
