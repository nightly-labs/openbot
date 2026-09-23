import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the settings context reaches in main: the app-wide preferences and the switches for
 * updates, notifications and the Dynamic Island.
 */
export interface SettingsPort {
  getAnalyticsPreference: OpenBotDesktopApi["getAnalyticsPreference"];
  getApprovalAutomation: OpenBotDesktopApi["getApprovalAutomation"];
  onOpenSettings: OpenBotDesktopApi["onOpenSettings"];
  setAnalyticsPreference: OpenBotDesktopApi["setAnalyticsPreference"];
  setApprovalAutomation: OpenBotDesktopApi["setApprovalAutomation"];
  dynamicIsland: Pick<OpenBotDesktopApi["dynamicIsland"], "getPreference" | "setPreference">;
  notifications: Pick<OpenBotDesktopApi["notifications"], "getPreference" | "openSettings" | "setPreference" | "test">;
  update: Pick<OpenBotDesktopApi["update"], "getPreference" | "setPreference">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function settingsPort(): SettingsPort {
  return window.openbot;
}
