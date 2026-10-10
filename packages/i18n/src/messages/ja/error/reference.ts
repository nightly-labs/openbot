import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "コード: {code}",
  "error.reference.copy": "エラーコードをコピー",
  "error.reference.copied": "エラーコードをコピーしました",
} as const satisfies PartialTranslation<typeof source>;
