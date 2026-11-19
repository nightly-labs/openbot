// Invite friends: the invite link, the credit and the friends of the account.

import { parseReferralPageRequest } from "@openbot/contracts/referral";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ReferralDesktopService } from "../referral-service";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function referralIpcHandlers({
  referral,
}: {
  referral: ReferralDesktopService;
}): Pick<IpcGroupHandlers, "referral"> {
  return {
    referral: {
      getState: payloadHandler(parsePageRequest, (request) => runCauseEffect(referral.getState(request))),
    },
  };
}

function parsePageRequest(input: unknown) {
  const request = parseReferralPageRequest(input);
  if (!request) throw new Error(sourceText("error.billing.invalidRequest"));
  return request;
}
