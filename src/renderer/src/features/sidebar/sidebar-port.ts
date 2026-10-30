import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the sidebar reaches in main: the saved sidebar layout and its changes, the free space on the
 * disk of a server for the storage card, and its machine use and alert levels for the machine card.
 */
export interface SidebarPort {
  agent: Pick<OpenBotDesktopApi["agent"], "getSidebarLayout" | "mutateSidebarLayout">;
  storage: Pick<OpenBotDesktopApi["storage"], "getDisk" | "getMachineMetrics">;
  hostAdmin: Pick<OpenBotDesktopApi["hostAdmin"], "getMachineAlerts">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function sidebarPort(): SidebarPort {
  return window.openbot;
}
