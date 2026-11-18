// The Stripe plans of the account's servers.

import { parseBillingPortalRequest, parseBillingStorageRequest } from "@openbot/contracts/billing";
import { parseBillingDetailsRequest } from "@openbot/contracts/billing-details";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BillingDesktopService } from "../billing-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function billingIpcHandlers({ billing }: { billing: BillingDesktopService }): Pick<IpcGroupHandlers, "billing"> {
  return {
    billing: {
      getState: handler(() => runCauseEffect(billing.getState())),
      openPortal: payloadHandler(parsePortalRequest, (request) => runCauseEffect(billing.openPortal(request))),
      buyStorage: payloadHandler(parseStorageRequest, (request) => runCauseEffect(billing.buyStorage(request))),
      getDetails: handler(() => runCauseEffect(billing.getDetails())),
      setDetails: payloadHandler(parseDetailsRequest, (request) => runCauseEffect(billing.setDetails(request))),
    },
  };
}

function parsePortalRequest(input: unknown) {
  const request = parseBillingPortalRequest(input);
  if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
  return request;
}

function parseStorageRequest(input: unknown) {
  const request = parseBillingStorageRequest(input);
  if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
  return request;
}

function parseDetailsRequest(input: unknown) {
  const request = parseBillingDetailsRequest(input);
  if (!request) throw new Error(sourceText("error.billing.detailsInvalid"));
  return request;
}
