import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes OpenBot installs for them.
 */
export interface ProvidersPort {
  cancelProviderCodeLogin: OpenBotDesktopApi["cancelProviderCodeLogin"];
  connectProvider: OpenBotDesktopApi["connectProvider"];
  refreshAgentProviders: OpenBotDesktopApi["refreshAgentProviders"];
  startProviderCodeLogin: OpenBotDesktopApi["startProviderCodeLogin"];
  providerRuntimes: OpenBotDesktopApi["providerRuntimes"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function providersPort(): ProvidersPort {
  return window.openbot;
}
