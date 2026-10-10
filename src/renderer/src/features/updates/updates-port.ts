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

// A version marker only. It never records a successful installation before the next launch.
const UPDATE_ATTEMPT_KEY = "openbot:update-attempt";

export function readUpdateAttempt(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_ATTEMPT_KEY);
  } catch {
    return null;
  }
}

export function writeUpdateAttempt(version: string | null): void {
  try {
    if (version === null) window.localStorage.removeItem(UPDATE_ATTEMPT_KEY);
    else window.localStorage.setItem(UPDATE_ATTEMPT_KEY, version);
  } catch {
    // An unavailable local store must not prevent an update or startup.
  }
}
