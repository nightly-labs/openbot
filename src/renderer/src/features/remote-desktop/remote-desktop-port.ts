import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface RemoteDesktopPort {
  remoteDesktop: Pick<
    OpenBotDesktopApi["remoteDesktop"],
    "connect" | "disconnect" | "list" | "onEvent" | "selectDisplay"
  >;
}

export function remoteDesktopPort(): RemoteDesktopPort {
  return window.openbot;
}
