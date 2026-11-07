// The commercial license of the account.

import {
  type LicenseCheckoutRequest,
  parseLicenseCheckoutRequest,
  parseLicensePlanRequest,
  parseLicenseRenewalRequest,
  parseLicenseUsersRequest,
} from "@openbot/contracts/license";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { LicenseDesktopService } from "../license-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function licenseIpcHandlers({ license }: { license: LicenseDesktopService }): Pick<IpcGroupHandlers, "license"> {
  return {
    license: {
      getState: handler(() => runCauseEffect(license.getState())),
      openCheckout: payloadHandler(validRequest<LicenseCheckoutRequest>(parseLicenseCheckoutRequest), (request) =>
        runCauseEffect(license.openCheckout(request)),
      ),
      setUsers: payloadHandler(validRequest(parseLicenseUsersRequest), (request) =>
        runCauseEffect(license.setUsers(request)),
      ),
      changePlan: payloadHandler(validRequest(parseLicensePlanRequest), (request) =>
        runCauseEffect(license.changePlan(request)),
      ),
      setRenewal: payloadHandler(validRequest(parseLicenseRenewalRequest), (request) =>
        runCauseEffect(license.setRenewal(request)),
      ),
    },
  };
}

function validRequest<T>(parse: (input: unknown) => T | null) {
  return (input: unknown): T => {
    const request = parse(input);
    if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
    return request;
  };
}
