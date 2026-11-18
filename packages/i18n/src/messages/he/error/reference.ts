import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "קוד: {code}",
  "error.reference.copy": "העתקת קוד השגיאה",
  "error.reference.copied": "קוד השגיאה הועתק",
} as const satisfies PartialTranslation<typeof source>;
