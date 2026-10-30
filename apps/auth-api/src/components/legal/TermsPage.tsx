import { Terms } from "../../content/terms";
import { TERMS_META, TERMS_ROUTE, TERMS_UPDATED_AT } from "../../lib/terms";
import { LegalPage } from "./LegalPage";

export function TermsPage() {
  return (
    <LegalPage route={TERMS_ROUTE} title={TERMS_META.title} updatedAt={TERMS_UPDATED_AT}>
      <Terms />
    </LegalPage>
  );
}
