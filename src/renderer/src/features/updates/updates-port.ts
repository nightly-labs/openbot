import type { IdleRestartTarget, OpenBotDesktopApi, UpdateStatus } from "@openbot/contracts/ipc";

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

/** What a restart when idle does: it installs a downloaded update, unless the host manages updates. */
export function idleRestartTarget(status: UpdateStatus): IdleRestartTarget {
  return status.phase === "ready" && status.managedByHost !== true ? "update" : "relaunch";
}
