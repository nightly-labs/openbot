// The cloud account: email sign-in, profile, and the mobile devices connected to it.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { LOCAL_SERVER_ID, type TestCompanySignInInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CentralAuthManager } from "../central-auth-manager";
import type { HostService } from "../host-service";
import { createHostedMobileConnect, createHostedMobileConnectLink } from "../mobile-connect-host";
import { parseEmailCodeVerification, parseProfileName } from "./app-inputs";
import { parseAvatarImage } from "./avatar-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject, requireString, stringPayload } from "./validation";

export interface AccountIpcDependencies {
  centralAuth: CentralAuthManager;
  host: Pick<HostService, "configure" | "getStatus" | "start" | "getMobileConnectHost">;
}

export function accountIpcHandlers({ centralAuth, host }: AccountIpcDependencies): Pick<IpcGroupHandlers, "auth"> {
  // The account service knows this computer's server by its host id, which is set once it is registered.
  const hostId = (serverId: string): string => {
    if (serverId !== LOCAL_SERVER_ID) return serverId;
    const local = host.getStatus().serverId;
    if (!local) throw new Error(sourceText("error.auth.companySignInNoServer"));
    return local;
  };
  return {
    auth: {
      getState: handler(() => centralAuth.getState()),
      retry: handler(() => runCauseEffect(centralAuth.retry())),
      requestEmailCode: payloadHandler(stringPayload("email", INPUT_LIMITS.email), (email) =>
        runCauseEffect(centralAuth.requestEmailCode(email)),
      ),
      verifyEmailCode: payloadHandler(parseEmailCodeVerification, (verification) =>
        runCauseEffect(centralAuth.verifyEmailCode(verification.challengeId, verification.code)),
      ),
      updateName: payloadHandler(parseProfileName, (name) => runCauseEffect(centralAuth.updateName(name))),
      updateAvatar: payloadHandler(parseAvatarImage, (parsed) => runCauseEffect(centralAuth.updateAvatar(parsed))),
      createMobileConnect: handler(() => runCauseEffect(createHostedMobileConnect({ centralAuth, host }))),
      cancelMobileConnect: handler(() => runCauseEffect(centralAuth.cancelMobileConnect(host.getMobileConnectHost()))),
      getMobileConnectLink: handler(() => centralAuth.getMobileConnectLink(host.getMobileConnectHost())),
      createMobileConnectLink: handler(() => runCauseEffect(createHostedMobileConnectLink({ centralAuth, host }))),
      revokeMobileConnectLink: handler(() =>
        runCauseEffect(centralAuth.revokeMobileConnectLink(host.getMobileConnectHost())),
      ),
      listMobileConnectedDevices: handler(() =>
        runCauseEffect(centralAuth.listMobileConnectedDevices(host.getMobileConnectHost())),
      ),
      listAccountSessions: handler(() => runCauseEffect(centralAuth.listAccountSessions())),
      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        runCauseEffect(centralAuth.revokeAccountSession(sessionId)),
      ),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        runCauseEffect(centralAuth.revokeMobileConnectedDevice(sessionId)),
      ),
      logout: handler(() => runCauseEffect(centralAuth.logout())),
      openCompanySignIn: handler(() => runCauseEffect(centralAuth.openCompanySignIn())),
      getCompanySignIn: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(centralAuth.companySignInSettings(hostId(serverId))),
      ),
      testCompanySignIn: payloadHandler(parseTestCompanySignIn, ({ serverId, ...input }) =>
        runCauseEffect(centralAuth.testCompanySignIn(hostId(serverId), input)),
      ),
      cancelCompanySignInTest: handler(() => runCauseEffect(centralAuth.cancelCompanySignInTest())),
      setCompanySignInEnabled: payloadHandler(parseSetCompanySignInEnabled, ({ serverId, enabled }) =>
        runCauseEffect(centralAuth.setCompanySignInEnabled(hostId(serverId), enabled)),
      ),
      removeCompanySignIn: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(centralAuth.removeCompanySignIn(hostId(serverId))),
      ),
      createCompanySignInScimToken: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(centralAuth.createCompanySignInScimToken(hostId(serverId))),
      ),
      revokeCompanySignInScimToken: payloadHandler(stringPayload("serverId"), (serverId) =>
        runCauseEffect(centralAuth.revokeCompanySignInScimToken(hostId(serverId))),
      ),
    },
  };
}

const COMPANY_SIGN_IN_FIELD = 1_024;
const COMPANY_SIGN_IN_DOMAINS = 20;

function parseTestCompanySignIn(input: unknown): TestCompanySignInInput {
  if (!isObject(input)) throw new Error("Company sign-in details are required.");
  const { clientSecret, domains } = input;
  if (typeof clientSecret !== "string" || clientSecret.length > COMPANY_SIGN_IN_FIELD) {
    throw new Error("clientSecret must be a string.");
  }
  if (!Array.isArray(domains) || domains.length > COMPANY_SIGN_IN_DOMAINS) {
    throw new Error("domains must be a list of at most 20 domains.");
  }
  return {
    serverId: requireString(input.serverId, "serverId"),
    issuer: requireString(input.issuer, "issuer", INPUT_LIMITS.browserUrl),
    clientId: requireString(input.clientId, "clientId", COMPANY_SIGN_IN_FIELD),
    clientSecret,
    domains: domains.map((domain) => requireString(domain, "domain", INPUT_LIMITS.hostname)),
  };
}

function parseSetCompanySignInEnabled(input: unknown): { serverId: string; enabled: boolean } {
  if (!isObject(input) || typeof input.enabled !== "boolean") throw new Error("enabled must be a boolean.");
  return { serverId: requireString(input.serverId, "serverId"), enabled: input.enabled };
}
