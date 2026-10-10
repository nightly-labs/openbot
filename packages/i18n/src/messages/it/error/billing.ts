import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "Non è stato possibile cambiare il piano del server. Aggiorna Fatturazione e riprova.",
  "error.billing.confirmMismatch": "Scrivi il nome del server per eliminarlo.",
  "error.billing.invalidRequest": "La richiesta di fatturazione non è valida.",
  "error.billing.invalidResponse": "La risposta di fatturazione non è valida.",
  "error.billing.notStripePage": "La pagina di fatturazione non è una pagina Stripe.",
} as const satisfies PartialTranslation<typeof source>;
