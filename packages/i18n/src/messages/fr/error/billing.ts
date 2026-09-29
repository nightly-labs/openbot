import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  // Billing errors.
  "error.billing.invalidRequest": "La demande de facturation n’est pas valide.",
  "error.billing.invalidResponse": "La réponse de facturation n’est pas valide.",
  "error.billing.notStripePage": "La page de facturation n’est pas une page Stripe.",
} as const satisfies PartialTranslation<typeof source>;
