import {
  type CreditActivity,
  type CreditsState,
  type CreditTransferRequest,
  parseCreditActivity,
  parseCreditsState,
} from "@openbot/contracts/credits";
import { type MobileSession, requestMobileAccount } from "@/features/auth/api/mobile-auth";
import { mockCreditActivity, mockCreditsState, mockMoveCredits } from "@/features/settings/api/credits-mock";
import { devMockCredits } from "@/shared/lib/dev-feature-overrides";
import { currentText } from "@/shared/lib/text";

export async function readCreditsState(session: MobileSession): Promise<CreditsState> {
  const state = await requestMobileAccount(
    session,
    "/v1/me/credits/",
    {},
    parseCreditsState,
    currentText().t("mobile.settings.credits.loadFailed"),
  );
  return devMockCredits() ? mockCreditsState(session.user.id, state) : state;
}

export function readCreditActivity(session: MobileSession): Promise<CreditActivity> {
  if (devMockCredits()) return Promise.resolve(mockCreditActivity(session.user.id));
  return requestMobileAccount(
    session,
    "/v1/me/credits/activity",
    {},
    parseCreditActivity,
    currentText().t("mobile.settings.credits.activity.loadFailed"),
  );
}

export function moveCredits(session: MobileSession, request: CreditTransferRequest): Promise<CreditsState> {
  if (devMockCredits()) return mockMoveCredits(session.user.id, request);
  return requestMobileAccount(
    session,
    "/v1/me/credits/transfer",
    { method: "POST", body: JSON.stringify(request) },
    parseCreditsState,
    currentText().t("mobile.settings.credits.move.failed"),
  );
}
