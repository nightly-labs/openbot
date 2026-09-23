import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the account context reaches in main: the OpenBot account session, its devices, and the
 * usage the account dock shows.
 */
export interface AccountPort {
  agent: Pick<OpenBotDesktopApi["agent"], "getUsage">;
  auth: Pick<
    OpenBotDesktopApi["auth"],
    | "createMobileConnect"
    | "getState"
    | "listAccountSessions"
    | "listMobileConnectedDevices"
    | "logout"
    | "onEvent"
    | "requestEmailCode"
    | "retry"
    | "revokeAccountSession"
    | "revokeMobileConnectedDevice"
    | "updateAvatar"
    | "updateName"
    | "verifyEmailCode"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function accountPort(): AccountPort {
  return window.openbot;
}
