import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** Local host IPC only. A joined server or web runtime does not use this port. */
export type CustomMessageRoutingPort = Pick<OpenBotDesktopApi, "getCustomMessageRouting" | "setCustomMessageRouting">;

export function customMessageRoutingPort(): CustomMessageRoutingPort {
  return window.openbot;
}
