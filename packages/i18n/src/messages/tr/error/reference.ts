import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Kod: {code}",
  "error.reference.copy": "Hata kodunu kopyala",
  "error.reference.copied": "Hata kodu kopyalandı",
} as const satisfies PartialTranslation<typeof source>;
