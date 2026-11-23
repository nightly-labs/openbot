import { type BillingState, parseBillingState } from "@openbot/contracts/billing";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

export function readBillingState(session: MobileSession): Promise<BillingState> {
  return requestMobileAccount(
    session,
    "/v1/me/billing/",
    {},
    parseBillingState,
    currentText().t("mobile.settings.billing.loadFailed"),
  );
}
