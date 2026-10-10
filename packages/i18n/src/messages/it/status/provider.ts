import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrotto. Riprova.",
  "status.provider.downloadFailed": "Download non riuscito. Riprova.",
  "status.provider.confirmContinue": "Continua",
  "status.provider.confirmCancel": "Annulla",
} as const satisfies PartialTranslation<typeof source>;
