import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface TeamPort {
  servers: Pick<OpenBotDesktopApi["servers"], "onPresence" | "setTyping">;
}

export function teamPort(): TeamPort {
  return window.openbot;
}
