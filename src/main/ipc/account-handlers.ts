// The cloud account: email sign-in, profile, and the mobile devices connected to it.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CentralAuthManager } from "../central-auth-manager";
import type { HostService } from "../host-service";
import { createHostedMobileConnect } from "../mobile-connect-host";
import { parseEmailCodeVerification, parseProfileName } from "./app-inputs";
import { parseAvatarImage } from "./avatar-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AccountIpcDependencies {
  centralAuth: CentralAuthManager;
  host: Pick<HostService, "configure" | "getStatus" | "start" | "getMobileConnectHost">;
}

export function accountIpcHandlers({ centralAuth, host }: AccountIpcDependencies): Pick<IpcGroupHandlers, "auth"> {
  return {
    auth: {
      getState: handler(() => centralAuth.getState()),
      retry: handler(() => centralAuth.retry()),
      requestEmailCode: payloadHandler(stringPayload("email", INPUT_LIMITS.email), (email) =>
        centralAuth.requestEmailCode(email),
      ),
      verifyEmailCode: payloadHandler(parseEmailCodeVerification, (verification) =>
        centralAuth.verifyEmailCode(verification.challengeId, verification.code),
      ),
      updateName: payloadHandler(parseProfileName, (name) => centralAuth.updateName(name)),
      updateAvatar: payloadHandler(parseAvatarImage, (parsed) => centralAuth.updateAvatar(parsed)),
      createMobileConnect: handler(() => createHostedMobileConnect({ centralAuth, host })),
      listMobileConnectedDevices: handler(() => centralAuth.listMobileConnectedDevices()),
      listAccountSessions: handler(() => centralAuth.listAccountSessions()),
      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        centralAuth.revokeAccountSession(sessionId),
      ),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        centralAuth.revokeMobileConnectedDevice(sessionId),
      ),
      logout: handler(() => centralAuth.logout()),
    },
  };
}
