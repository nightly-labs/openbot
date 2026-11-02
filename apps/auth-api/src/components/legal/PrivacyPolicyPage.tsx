import { PrivacyPolicy } from "../../content/privacy-policy";
import { PRIVACY_POLICY_META, PRIVACY_POLICY_ROUTE, PRIVACY_POLICY_UPDATED_AT } from "../../lib/privacy-policy";
import { LegalPage } from "./LegalPage";

export function PrivacyPolicyPage() {
  return (
    <LegalPage route={PRIVACY_POLICY_ROUTE} title={PRIVACY_POLICY_META.title} updatedAt={PRIVACY_POLICY_UPDATED_AT}>
      <PrivacyPolicy />
    </LegalPage>
  );
}
