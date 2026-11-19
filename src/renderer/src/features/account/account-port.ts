import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

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

export function accountPort(): AccountPort {
  return window.openbot;
}
