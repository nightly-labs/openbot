import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the updates context reaches in main: the app update status and its check, download and
 * install steps.
 */
export interface UpdatesPort {
  update: Pick<OpenBotDesktopApi["update"], "check" | "download" | "getStatus" | "install" | "onEvent">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function updatesPort(): UpdatesPort {
  return window.openbot;
}
