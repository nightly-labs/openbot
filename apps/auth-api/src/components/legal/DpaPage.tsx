import { Dpa } from "../../content/dpa";
import { DPA_META, DPA_ROUTE, DPA_UPDATED_AT } from "../../lib/dpa";
import { LegalPage } from "./LegalPage";

export function DpaPage() {
  return (
    <LegalPage route={DPA_ROUTE} title={DPA_META.title} updatedAt={DPA_UPDATED_AT}>
      <Dpa />
    </LegalPage>
  );
}
