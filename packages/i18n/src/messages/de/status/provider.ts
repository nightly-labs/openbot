import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download gestoppt. Versuche es erneut.",
  "status.provider.downloadFailed": "Download fehlgeschlagen. Versuche es erneut.",
  "status.provider.updateWaiting": "Das Update startet, wenn der aktuelle Durchlauf endet.",
  "status.provider.confirmContinue": "Weiter",
  "status.provider.confirmCancel": "Abbrechen",
  "status.provider.retryUnreachable":
    "{provider} kann keine Verbindung zu seinem Server herstellen. Versuch {attempt} von {maxAttempts}.",
  "status.provider.retryServerError":
    "Der {provider}-Server ist ausgelastet oder hat einen Fehler. Versuch {attempt} von {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} erhält wieder Antworten von seinem Server.",
} as const satisfies PartialTranslation<typeof source>;
