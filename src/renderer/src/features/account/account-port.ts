import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the account context reaches in main: the OpenBot account session, its devices, and the
 * usage the page rail and the Usage page show.
 */
export interface AccountPort {
  agent: Pick<OpenBotDesktopApi["agent"], "getUsage">;
  auth: Pick<
    OpenBotDesktopApi["auth"],
    | "cancelMobileConnect"
    | "createMobileConnect"
    | "createMobileConnectLink"
    | "getMobileConnectLink"
    | "getState"
    | "listAccountSessions"
    | "listMobileConnectedDevices"
    | "logout"
    | "onEvent"
    | "openCompanySignIn"
    | "requestEmailCode"
    | "retry"
    | "revokeAccountSession"
    | "revokeMobileConnectedDevice"
    | "revokeMobileConnectLink"
    | "updateAvatar"
    | "updateChatColor"
    | "updateName"
    | "verifyEmailCode"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function accountPort(): AccountPort {
  return window.openbot;
}
