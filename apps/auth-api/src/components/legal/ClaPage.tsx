import { Cla } from "../../content/cla";
import { CLA_META, CLA_ROUTE, CLA_UPDATED_AT } from "../../lib/cla";
import { LegalPage } from "./LegalPage";

export function ClaPage() {
  return (
    <LegalPage route={CLA_ROUTE} title={CLA_META.title} updatedAt={CLA_UPDATED_AT}>
      <Cla />
    </LegalPage>
  );
}
