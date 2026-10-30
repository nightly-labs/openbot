import { CommercialLicense } from "../../content/commercial-license";
import {
  COMMERCIAL_LICENSE_META,
  COMMERCIAL_LICENSE_ROUTE,
  COMMERCIAL_LICENSE_UPDATED_AT,
} from "../../lib/commercial-license";
import { LegalPage } from "./LegalPage";

export function CommercialLicensePage() {
  return (
    <LegalPage
      route={COMMERCIAL_LICENSE_ROUTE}
      title={COMMERCIAL_LICENSE_META.title}
      updatedAt={COMMERCIAL_LICENSE_UPDATED_AT}
    >
      <CommercialLicense />
    </LegalPage>
  );
}
