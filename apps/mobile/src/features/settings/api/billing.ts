import { type BillingState, parseBillingState } from "@openbot/contracts/billing";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

/**
 * The plans of the account's hosted servers, read only. App store rules do not allow a purchase or a
 * link to a purchase outside the store, so the phone does not open the Stripe Customer Portal.
 */
export function readBillingState(session: MobileSession): Promise<BillingState> {
  return requestMobileAccount(
    session,
    "/v1/me/billing/",
    {},
    parseBillingState,
    currentText().t("mobile.settings.billing.loadFailed"),
  );
}
