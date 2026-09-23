import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the sidebar reaches in main: the saved sidebar layout and its changes.
 */
export interface SidebarPort {
  agent: Pick<OpenBotDesktopApi["agent"], "getSidebarLayout" | "mutateSidebarLayout">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function sidebarPort(): SidebarPort {
  return window.openbot;
}
