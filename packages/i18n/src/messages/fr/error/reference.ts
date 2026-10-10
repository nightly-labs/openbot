import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Code : {code}",
  "error.reference.copy": "Copier le code d’erreur",
  "error.reference.copied": "Code d’erreur copié",
} as const satisfies PartialTranslation<typeof source>;
