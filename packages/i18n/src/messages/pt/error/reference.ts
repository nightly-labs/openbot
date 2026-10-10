import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Código: {code}",
  "error.reference.copy": "Copiar código de erro",
  "error.reference.copied": "Código de erro copiado",
} as const satisfies PartialTranslation<typeof source>;
