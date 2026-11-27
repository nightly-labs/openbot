import {
  parseCreditCheckoutRequest,
  parseCreditRedeemRequest,
  parseCreditTransferRequest,
} from "@openbot/contracts/credits";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CreditsDesktopService } from "../credits-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function creditsIpcHandlers({ credits }: { credits: CreditsDesktopService }): Pick<IpcGroupHandlers, "credits"> {
  return {
    credits: {
      getState: handler(() => runCauseEffect(credits.getState())),
      getActivity: handler(() => runCauseEffect(credits.getActivity())),
      getCatalog: handler(() => runCauseEffect(credits.getCatalog())),
      openCheckout: payloadHandler(validRequest(parseCreditCheckoutRequest), (request) =>
        runCauseEffect(credits.openCheckout(request)),
      ),
      transfer: payloadHandler(validRequest(parseCreditTransferRequest), (request) =>
        runCauseEffect(credits.transfer(request)),
      ),
      redeem: payloadHandler(validRequest(parseCreditRedeemRequest), (request) =>
        runCauseEffect(credits.redeem(request)),
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
