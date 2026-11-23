import {
  type CreditActivity,
  type CreditsState,
  parseCreditActivity,
  parseCreditsState,
} from "@openbot/contracts/credits";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

export function readCreditsState(session: MobileSession): Promise<CreditsState> {
  return requestMobileAccount(
    session,
    "/v1/me/credits/",
    {},
    parseCreditsState,
    currentText().t("mobile.settings.credits.loadFailed"),
  );
}

export function readCreditActivity(session: MobileSession): Promise<CreditActivity> {
  return requestMobileAccount(
    session,
    "/v1/me/credits/activity",
    {},
    parseCreditActivity,
    currentText().t("mobile.settings.credits.activity.loadFailed"),
  );
}
