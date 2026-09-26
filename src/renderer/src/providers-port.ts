import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes OpenBot installs for them, on this computer or on a host the account administers.
 */
export interface ProvidersPort {
  cancelProviderCodeLogin: OpenBotDesktopApi["cancelProviderCodeLogin"];
  connectProvider: OpenBotDesktopApi["connectProvider"];
  refreshAgentProviders: OpenBotDesktopApi["refreshAgentProviders"];
  startProviderCodeLogin: OpenBotDesktopApi["startProviderCodeLogin"];
  providerRuntimes: OpenBotDesktopApi["providerRuntimes"];
  /** The same, for the host of a joined server the account administers. */
  providerAdmin: OpenBotDesktopApi["providerAdmin"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function providersPort(): ProvidersPort {
  return window.openbot;
}
