import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface BrowserDockPort {
  agent: Pick<OpenBotDesktopApi["agent"], "respondToBrowserSecret">;
  browserDock: Pick<
    OpenBotDesktopApi["browserDock"],
    "getPresentation" | "onPresentation" | "performAction" | "setFrame"
  >;
}

export function browserDockPort(): BrowserDockPort {
  return window.openbot;
}
