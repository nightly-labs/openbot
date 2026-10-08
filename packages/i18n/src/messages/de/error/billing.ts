import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.invalidRequest": "Die Abrechnungsanfrage ist ungültig.",
  "error.billing.invalidResponse": "Die Abrechnungsantwort ist ungültig.",
  "error.billing.notStripePage": "Die Abrechnungsseite ist keine Stripe-Seite.",
} as const satisfies PartialTranslation<typeof source>;
