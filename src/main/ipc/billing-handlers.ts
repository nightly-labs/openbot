// The Stripe plans of the account's servers.

import { parseBillingPortalRequest } from "@openbot/contracts/billing";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BillingDesktopService } from "../billing-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function billingIpcHandlers({ billing }: { billing: BillingDesktopService }): Pick<IpcGroupHandlers, "billing"> {
  return {
    billing: {
      getState: handler(() => runCauseEffect(billing.getState())),
      openPortal: payloadHandler(parsePortalRequest, (request) => runCauseEffect(billing.openPortal(request))),
    },
  };
}

function parsePortalRequest(input: unknown) {
  const request = parseBillingPortalRequest(input);
  if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
  return request;
}
