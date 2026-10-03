import { Effect } from "effect";
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
      retry: handler(() => Effect.runPromise(centralAuth.retry().pipe(Effect.mapError((error) => error.cause)))),
      requestEmailCode: payloadHandler(stringPayload("email", INPUT_LIMITS.email), (email) =>
        Effect.runPromise(centralAuth.requestEmailCode(email).pipe(Effect.mapError((error) => error.cause))),
      ),
      verifyEmailCode: payloadHandler(parseEmailCodeVerification, (verification) =>
        Effect.runPromise(
          centralAuth
            .verifyEmailCode(verification.challengeId, verification.code)
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      updateName: payloadHandler(parseProfileName, (name) =>
        Effect.runPromise(centralAuth.updateName(name).pipe(Effect.mapError((error) => error.cause))),
      ),
      updateAvatar: payloadHandler(parseAvatarImage, (parsed) =>
        Effect.runPromise(centralAuth.updateAvatar(parsed).pipe(Effect.mapError((error) => error.cause))),
      ),
      createMobileConnect: handler(() =>
        Effect.runPromise(
          createHostedMobileConnect({ centralAuth, host }).pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      listMobileConnectedDevices: handler(() =>
        Effect.runPromise(centralAuth.listMobileConnectedDevices().pipe(Effect.mapError((error) => error.cause))),
      ),
      listAccountSessions: handler(() =>
        Effect.runPromise(centralAuth.listAccountSessions().pipe(Effect.mapError((error) => error.cause))),
      ),
      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        Effect.runPromise(centralAuth.revokeAccountSession(sessionId).pipe(Effect.mapError((error) => error.cause))),
      ),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        Effect.runPromise(
          centralAuth.revokeMobileConnectedDevice(sessionId).pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      logout: handler(() => Effect.runPromise(centralAuth.logout().pipe(Effect.mapError((error) => error.cause)))),
    },
  };
}
