import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes OpenBot installs for them, on this computer or on a host the account administers.
 */
export interface ProvidersPort {
  cancelProviderCodeLogin: OpenBotDesktopApi["cancelProviderCodeLogin"];
  connectProvider: OpenBotDesktopApi["connectProvider"];
  cancelProviderSignIn: OpenBotDesktopApi["cancelProviderSignIn"];
  refreshAgentProviders: OpenBotDesktopApi["refreshAgentProviders"];
  setProviderOn: OpenBotDesktopApi["setProviderOn"];
  restartProvider: OpenBotDesktopApi["restartProvider"];
  cancelProviderRestart: OpenBotDesktopApi["cancelProviderRestart"];
  startProviderCodeLogin: OpenBotDesktopApi["startProviderCodeLogin"];
  providerRuntimes: OpenBotDesktopApi["providerRuntimes"];
  connectProviderAccount: OpenBotDesktopApi["connectProviderAccount"];
  cancelProviderAccountSignIn: OpenBotDesktopApi["cancelProviderAccountSignIn"];
  renameProviderAccount: OpenBotDesktopApi["renameProviderAccount"];
  removeProviderAccount: OpenBotDesktopApi["removeProviderAccount"];
  signOutProvider: OpenBotDesktopApi["signOutProvider"];
  providerUsageResets: OpenBotDesktopApi["providerUsageResets"];
  resetProviderUsage: OpenBotDesktopApi["resetProviderUsage"];
  /** The same, for the host of a joined server the account administers. */
  providerAdmin: OpenBotDesktopApi["providerAdmin"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function providersPort(): ProvidersPort {
  return window.openbot;
}
