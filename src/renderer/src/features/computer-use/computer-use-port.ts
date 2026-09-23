import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What Computer Use reaches in main: the driver state, the macOS permission panes and helper, and
 * the highlight placement. The helper and highlight windows have no provider tree, so this is a
 * module.
 */
export interface ComputerUsePort {
  closeComputerUsePermissionHelp: OpenBotDesktopApi["closeComputerUsePermissionHelp"];
  getComputerUsePermissionApp: OpenBotDesktopApi["getComputerUsePermissionApp"];
  getComputerUseState: OpenBotDesktopApi["getComputerUseState"];
  onComputerUseHighlightPlacement: OpenBotDesktopApi["onComputerUseHighlightPlacement"];
  openComputerUsePermissionPane: OpenBotDesktopApi["openComputerUsePermissionPane"];
  revealComputerUsePermissionApp: OpenBotDesktopApi["revealComputerUsePermissionApp"];
  startComputerUsePermissionAppDrag: OpenBotDesktopApi["startComputerUsePermissionAppDrag"];
  remoteDesktop: Pick<OpenBotDesktopApi["remoteDesktop"], "checkSetup">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function computerUsePort(): ComputerUsePort {
  return window.openbot;
}
