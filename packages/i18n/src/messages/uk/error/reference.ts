import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Kod: {code}",
  "error.reference.copy": "Kopiuj kod błędu",
  "error.reference.copied": "Skopiowano kod błędu",
} as const satisfies PartialTranslation<typeof source>;
