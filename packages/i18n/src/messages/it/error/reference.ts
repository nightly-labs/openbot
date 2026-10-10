import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Codice: {code}",
  "error.reference.copy": "Copia il codice errore",
  "error.reference.copied": "Codice errore copiato",
} as const satisfies PartialTranslation<typeof source>;
