import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What Computer Use reaches in main: the driver state, the macOS permission panes and helper, the
 * highlight placement, and the restart that a refused Accessibility grant needs. The helper and
 * highlight windows have no provider tree, so this is a module.
 */
export interface ComputerUsePort {
  computerUse: OpenBotDesktopApi["computerUse"];
  remoteDesktop: Pick<OpenBotDesktopApi["remoteDesktop"], "checkSetup">;
  update: Pick<OpenBotDesktopApi["update"], "getStatus" | "restartWhenIdle">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function computerUsePort(): ComputerUsePort {
  return window.openbot;
}
