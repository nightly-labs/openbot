import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download gestoppt. Versuche es erneut.",
  "status.provider.downloadFailed": "Download fehlgeschlagen. Versuche es erneut.",
  "status.provider.confirmContinue": "Weiter",
  "status.provider.confirmCancel": "Abbrechen",
} as const satisfies PartialTranslation<typeof source>;
