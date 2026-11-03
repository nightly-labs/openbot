import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download gestopt. Probeer het opnieuw.",
  "status.provider.downloadFailed": "Download mislukt. Probeer het opnieuw.",
  "status.provider.updateWaiting": "De update start als de huidige beurt klaar is.",
  "status.provider.confirmContinue": "Doorgaan",
  "status.provider.confirmCancel": "Annuleren",
  "status.provider.retryUnreachable":
    "{provider} kan geen verbinding maken met zijn server. Poging {attempt} van {maxAttempts}.",
  "status.provider.retryServerError":
    "De server van {provider} is bezet of heeft een fout. Poging {attempt} van {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} krijgt weer antwoorden van zijn server.",
} as const satisfies PartialTranslation<typeof source>;
