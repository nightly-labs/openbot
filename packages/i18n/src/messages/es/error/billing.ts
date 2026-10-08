import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.invalidRequest": "La solicitud de facturación no es válida.",
  "error.billing.invalidResponse": "La respuesta de facturación no es válida.",
  "error.billing.notStripePage": "La página de facturación no es una página de Stripe.",
} as const satisfies PartialTranslation<typeof source>;
