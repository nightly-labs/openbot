import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the updates context reaches in main: the app update status, its check, download and
 * install steps, the cancel of a restart that a server admin asked for, and the restart when idle.
 */
export interface UpdatesPort {
  update: Pick<
    OpenBotDesktopApi["update"],
    | "check"
    | "download"
    | "getStatus"
    | "install"
    | "onEvent"
    | "cancelScheduledRestart"
    | "restartWhenIdle"
    | "cancelIdleRestart"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function updatesPort(): UpdatesPort {
  return window.openbot;
}
