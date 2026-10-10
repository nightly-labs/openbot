import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Pobieranie zatrzymane. Spróbuj ponownie.",
  "status.provider.downloadFailed": "Pobieranie nie powiodło się. Spróbuj ponownie.",
  "status.provider.confirmContinue": "Kontynuuj",
  "status.provider.confirmCancel": "Anuluj",
} as const satisfies PartialTranslation<typeof source>;
