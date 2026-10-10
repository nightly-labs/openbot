import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "Der Servertarif konnte nicht geändert werden. Aktualisiere die Abrechnung und versuche es erneut.",
  "error.billing.confirmMismatch": "Gib den Servernamen ein, um ihn zu löschen.",
  "error.billing.invalidRequest": "Die Abrechnungsanfrage ist ungültig.",
  "error.billing.invalidResponse": "Die Abrechnungsantwort ist ungültig.",
  "error.billing.notStripePage": "Die Abrechnungsseite ist keine Stripe-Seite.",
} as const satisfies PartialTranslation<typeof source>;
