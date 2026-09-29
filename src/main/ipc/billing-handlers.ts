// The Stripe plans of the account's servers.

import { parseBillingPortalRequest } from "@openbot/contracts/billing";
import { sourceText } from "@openbot/i18n/source";
import type { BillingDesktopService } from "../billing-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function billingIpcHandlers({ billing }: { billing: BillingDesktopService }): Pick<IpcGroupHandlers, "billing"> {
  return {
    billing: {
      getState: handler(() => billing.getState()),
      openPortal: payloadHandler(parsePortalRequest, (request) => billing.openPortal(request)),
    },
  };
}

function parsePortalRequest(input: unknown) {
  const request = parseBillingPortalRequest(input);
  if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
  return request;
}
