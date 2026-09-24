import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the custom providers context reaches in main: the endpoints the user named.
 */
export interface CustomProvidersPort {
  customProviders: OpenBotDesktopApi["customProviders"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function customProvidersPort(): CustomProvidersPort {
  return window.openbot;
}
