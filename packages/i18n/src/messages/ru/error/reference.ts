import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Код: {code}",
  "error.reference.copy": "Скопировать код ошибки",
  "error.reference.copied": "Код ошибки скопирован",
} as const satisfies PartialTranslation<typeof source>;
