import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the window buttons reach in main. Read on each call: tests and stories replace `window.openbot` per case. */
export function windowControlsPort(): OpenBotDesktopApi["windowControls"] {
  return window.openbot.windowControls;
}
