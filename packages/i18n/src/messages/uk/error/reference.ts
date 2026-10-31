import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Код: {code}",
  "error.reference.copy": "Копіювати код помилки",
  "error.reference.copied": "Код помилки скопійовано",
} as const satisfies PartialTranslation<typeof source>;
