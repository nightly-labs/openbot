import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

/** The short code that `errorReference` in `@openbot/user-errors` builds for a failure. */
export const messages = {
  "error.reference.label": "錯誤碼：{code}",
  "error.reference.copy": "複製錯誤碼",
  "error.reference.copied": "錯誤碼已複製",
} as const satisfies PartialTranslation<typeof source>;
