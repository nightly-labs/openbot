import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface ComputerUsePort {
  computerUse: OpenBotDesktopApi["computerUse"];
  remoteDesktop: Pick<OpenBotDesktopApi["remoteDesktop"], "checkSetup">;
  update: Pick<OpenBotDesktopApi["update"], "getStatus" | "restartWhenIdle">;
}

export function computerUsePort(): ComputerUsePort {
  return window.openbot;
}
