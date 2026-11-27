import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface SidebarPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "getSidebarLayout" | "mutateSidebarLayout" | "getSidebarPins" | "setSidebarPins" | "seedSidebarPins"
  >;
  storage: Pick<OpenBotDesktopApi["storage"], "getDisk" | "getMachineMetrics">;
  hostAdmin: Pick<OpenBotDesktopApi["hostAdmin"], "getMachineAlerts">;
}

export type SidebarCardsPort = Pick<SidebarPort, "storage" | "hostAdmin">;

export function sidebarPort(): SidebarPort {
  return window.openbot;
}
