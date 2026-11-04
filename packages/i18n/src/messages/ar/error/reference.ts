import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "الرمز: {code}",
  "error.reference.copy": "نسخ رمز الخطأ",
  "error.reference.copied": "تم نسخ رمز الخطأ",
} as const satisfies PartialTranslation<typeof source>;
