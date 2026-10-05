import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the 1Password page reaches in main: the one 1Password connection of this computer. */
export type OnePasswordConnectorPort = OpenBotDesktopApi["onePasswordConnector"];

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function onePasswordConnectorPort(): OnePasswordConnectorPort {
  return window.openbot.onePasswordConnector;
}
