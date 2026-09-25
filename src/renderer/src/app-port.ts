import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the app shell and the cross-domain root modules reach in main, plus the shell actions
 * (`openUrl`, `openExternal`) that several domains share.
 */
export interface AppPort {
  getAppInfo: OpenBotDesktopApi["getAppInfo"];
  getAppLanguagePreference: OpenBotDesktopApi["getAppLanguagePreference"];
  onAppLanguagePreference: OpenBotDesktopApi["onAppLanguagePreference"];
  openExternal: OpenBotDesktopApi["openExternal"];
  openUrl: OpenBotDesktopApi["openUrl"];
  setAppLanguagePreference: OpenBotDesktopApi["setAppLanguagePreference"];
  agent: Pick<OpenBotDesktopApi["agent"], "readConversationPage" | "searchConversationMessages">;
  agentTemplates: Pick<OpenBotDesktopApi["agentTemplates"], "onOpenLink" | "takePendingLink">;
  hostedSites: OpenBotDesktopApi["hostedSites"];
  plugins: Pick<OpenBotDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  servers: Pick<OpenBotDesktopApi["servers"], "onInvite" | "takePendingInvite">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function appPort(): AppPort {
  return window.openbot;
}
