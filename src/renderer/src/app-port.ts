import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { CompanySignInCalls } from "./features/servers/ServerCompanySignInSection";

export interface AppPort {
  getAppInfo: OpenBotDesktopApi["getAppInfo"];
  getAppAppearancePreference: OpenBotDesktopApi["getAppAppearancePreference"];
  getAppInterfaceSizePreference: OpenBotDesktopApi["getAppInterfaceSizePreference"];
  getAppLanguagePreference: OpenBotDesktopApi["getAppLanguagePreference"];
  getAppLogoColorPreference: OpenBotDesktopApi["getAppLogoColorPreference"];
  listInstalledFonts: OpenBotDesktopApi["listInstalledFonts"];
  onAppAppearancePreference: OpenBotDesktopApi["onAppAppearancePreference"];
  onAppInterfaceSizePreference: OpenBotDesktopApi["onAppInterfaceSizePreference"];
  onAppLanguagePreference: OpenBotDesktopApi["onAppLanguagePreference"];
  onAppLogoColorPreference: OpenBotDesktopApi["onAppLogoColorPreference"];
  openExternal: OpenBotDesktopApi["openExternal"];
  getSentMessageStats: OpenBotDesktopApi["getSentMessageStats"];
  reportRendererTiming: OpenBotDesktopApi["reportRendererTiming"];
  openUrl: OpenBotDesktopApi["openUrl"];
  openChatWindow: OpenBotDesktopApi["openChatWindow"];
  getChatWindows: OpenBotDesktopApi["getChatWindows"];
  onChatWindows: OpenBotDesktopApi["onChatWindows"];
  onQuitShortcutHint: OpenBotDesktopApi["onQuitShortcutHint"];
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
  referral: OpenBotDesktopApi["referral"];
  license: OpenBotDesktopApi["license"];
  auth: CompanySignInCalls;
  hostedServers: OpenBotDesktopApi["hostedServers"];
  routineFeed: OpenBotDesktopApi["routineFeed"];
  events: OpenBotDesktopApi["events"];
  plugins: Pick<OpenBotDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  marketplace: Pick<OpenBotDesktopApi["marketplace"], "onOpenListing" | "takePendingListing">;
  servers: Pick<OpenBotDesktopApi["servers"], "onInvite" | "takePendingInvite">;
}

export function appPort(): AppPort {
  return window.openbot;
}
