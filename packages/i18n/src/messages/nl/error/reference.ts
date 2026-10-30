import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Code: {code}",
  "error.reference.copy": "Foutcode kopiëren",
  "error.reference.copied": "Foutcode gekopieerd",
} as const satisfies PartialTranslation<typeof source>;
