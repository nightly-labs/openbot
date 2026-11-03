import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrotto. Riprova.",
  "status.provider.downloadFailed": "Download non riuscito. Riprova.",
  "status.provider.updateWaiting": "L'aggiornamento parte quando finisce il turno in corso.",
  "status.provider.confirmContinue": "Continua",
  "status.provider.confirmCancel": "Annulla",
  "status.provider.retryUnreachable":
    "{provider} non riesce a connettersi al suo server. Tentativo {attempt} di {maxAttempts}.",
  "status.provider.retryServerError":
    "Il server di {provider} è occupato o ha un errore. Tentativo {attempt} di {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} riceve di nuovo risposte dal suo server.",
} as const satisfies PartialTranslation<typeof source>;
