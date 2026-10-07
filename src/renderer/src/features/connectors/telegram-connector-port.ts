import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Telegram page reaches in main: the Telegram bots of this computer. */
export interface TelegramConnectorPort {
  messaging: OpenBotDesktopApi["messaging"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function telegramConnectorPort(): TelegramConnectorPort {
  return { messaging: window.openbot.messaging };
}
