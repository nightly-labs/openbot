import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the settings context reaches in main: the app-wide preferences, the switches for updates,
 * notifications and the Dynamic Island, the local agents and their background processes of the
 * Agents tab, and the agents and the user's own notification levels of each server for the
 * Notifications tab.
 */
export interface SettingsPort {
  getAgentDefaults: OpenBotDesktopApi["getAgentDefaults"];
  getAgentMemoryLimitPreference: OpenBotDesktopApi["getAgentMemoryLimitPreference"];
  getAnalyticsPreference: OpenBotDesktopApi["getAnalyticsPreference"];
  getAppBehaviorPreference: OpenBotDesktopApi["getAppBehaviorPreference"];
  getApprovalAutomation: OpenBotDesktopApi["getApprovalAutomation"];
  getBusyMessageModePreference: OpenBotDesktopApi["getBusyMessageModePreference"];
  getExternalLinkPreference: OpenBotDesktopApi["getExternalLinkPreference"];
  listExternalLinkBrowsers: OpenBotDesktopApi["listExternalLinkBrowsers"];
  chooseExternalLinkApp: OpenBotDesktopApi["chooseExternalLinkApp"];
  onExternalLinkFallback: OpenBotDesktopApi["onExternalLinkFallback"];
  getRemoteNetworkRoute: OpenBotDesktopApi["getRemoteNetworkRoute"];
  getRemoteSessionReusePreference: OpenBotDesktopApi["getRemoteSessionReusePreference"];
  onAgentMemoryLimitPreference: OpenBotDesktopApi["onAgentMemoryLimitPreference"];
  onAnalyticsPreference: OpenBotDesktopApi["onAnalyticsPreference"];
  onApprovalAutomation: OpenBotDesktopApi["onApprovalAutomation"];
  onOpenSettings: OpenBotDesktopApi["onOpenSettings"];
  onOpenUpdateSettings: OpenBotDesktopApi["onOpenUpdateSettings"];
  setAgentDefaults: OpenBotDesktopApi["setAgentDefaults"];
  setAnalyticsPreference: OpenBotDesktopApi["setAnalyticsPreference"];
  setAppBehaviorPreference: OpenBotDesktopApi["setAppBehaviorPreference"];
  setBusyMessageModePreference: OpenBotDesktopApi["setBusyMessageModePreference"];
  setExternalLinkPreference: OpenBotDesktopApi["setExternalLinkPreference"];
  setRemoteNetworkRoute: OpenBotDesktopApi["setRemoteNetworkRoute"];
  setRemoteSessionReusePreference: OpenBotDesktopApi["setRemoteSessionReusePreference"];
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "listAgents" | "updateAgent" | "listAgentNotificationLevels" | "setAgentNotificationLevel" | "onScopedEvent"
  >;
  backgroundProcesses: OpenBotDesktopApi["backgroundProcesses"];
  dynamicIsland: Pick<
    OpenBotDesktopApi["dynamicIsland"],
    "getBuiltInDisplayGeometry" | "getPreference" | "setPreference"
  >;
  notifications: Pick<OpenBotDesktopApi["notifications"], "getPreference" | "openSettings" | "setPreference" | "test">;
  update: Pick<OpenBotDesktopApi["update"], "getPreference" | "onPreference" | "setPreference">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function settingsPort(): SettingsPort {
  return window.openbot;
}
