import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

/** The short code that `errorReference` in `@openbot/user-errors` builds for a failure. */
export const messages = {
  "error.reference.label": "错误码：{code}",
  "error.reference.copy": "复制错误码",
  "error.reference.copied": "错误码已复制",
} as const satisfies PartialTranslation<typeof source>;
