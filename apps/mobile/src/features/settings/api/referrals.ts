import { parseReferralState, type ReferralState } from "@openbot/contracts/referral";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { currentText } from "@/shared/lib/text";

export function readReferralState(session: MobileSession): Promise<ReferralState> {
  return requestMobileAccount(
    session,
    "/v1/me/referrals",
    {},
    parseReferralState,
    currentText().t("mobile.settings.invite.loadFailed"),
  );
}
