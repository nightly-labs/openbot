import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Discord page reaches in main: the Discord servers of this computer. */
export interface DiscordConnectorPort {
  messaging: OpenBotDesktopApi["messaging"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function discordConnectorPort(): DiscordConnectorPort {
  return { messaging: window.openbot.messaging };
}
