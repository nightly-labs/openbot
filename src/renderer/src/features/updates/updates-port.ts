import type { IdleRestartTarget, OpenBotDesktopApi, UpdateStatus } from "@openbot/contracts/ipc";

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
    | "restartNow"
  >;
}

export function updatesPort(): UpdatesPort {
  return window.openbot;
}

export function idleRestartTarget(status: UpdateStatus): IdleRestartTarget {
  return status.phase === "ready" && status.managedByHost !== true ? "update" : "relaunch";
}
