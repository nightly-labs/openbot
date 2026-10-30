import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the app shell and the cross-domain root modules reach in main, plus the shell actions
 * (`openUrl`, `openExternal`) that several domains share.
 */
export interface AppPort {
  getAppInfo: OpenBotDesktopApi["getAppInfo"];
  getAppAppearancePreference: OpenBotDesktopApi["getAppAppearancePreference"];
  getAppInterfaceSizePreference: OpenBotDesktopApi["getAppInterfaceSizePreference"];
  getAppLanguagePreference: OpenBotDesktopApi["getAppLanguagePreference"];
  getAppLogoColorPreference: OpenBotDesktopApi["getAppLogoColorPreference"];
  onAppAppearancePreference: OpenBotDesktopApi["onAppAppearancePreference"];
  onAppInterfaceSizePreference: OpenBotDesktopApi["onAppInterfaceSizePreference"];
  onAppLanguagePreference: OpenBotDesktopApi["onAppLanguagePreference"];
  onAppLogoColorPreference: OpenBotDesktopApi["onAppLogoColorPreference"];
  openExternal: OpenBotDesktopApi["openExternal"];
  openUrl: OpenBotDesktopApi["openUrl"];
  openChatWindow: OpenBotDesktopApi["openChatWindow"];
  getChatWindows: OpenBotDesktopApi["getChatWindows"];
  onChatWindows: OpenBotDesktopApi["onChatWindows"];
  setAppAppearancePreference: OpenBotDesktopApi["setAppAppearancePreference"];
  setAppInterfaceSizePreference: OpenBotDesktopApi["setAppInterfaceSizePreference"];
  setAppLanguagePreference: OpenBotDesktopApi["setAppLanguagePreference"];
  setAppLogoColorPreference: OpenBotDesktopApi["setAppLogoColorPreference"];
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "readConversationPage" | "searchConversationMessages" | "searchConversationFiles" | "listRoutines" | "listAgents"
  >;
  agentTemplates: Pick<OpenBotDesktopApi["agentTemplates"], "onOpenLink" | "takePendingLink">;
  acpRegistry: OpenBotDesktopApi["acpRegistry"];
  hostedSites: OpenBotDesktopApi["hostedSites"];
  billing: OpenBotDesktopApi["billing"];
  license: OpenBotDesktopApi["license"];
  hostedServers: OpenBotDesktopApi["hostedServers"];
  routineFeed: OpenBotDesktopApi["routineFeed"];
  events: OpenBotDesktopApi["events"];
  plugins: Pick<OpenBotDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  servers: Pick<OpenBotDesktopApi["servers"], "onInvite" | "takePendingInvite">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function appPort(): AppPort {
  return window.openbot;
}
