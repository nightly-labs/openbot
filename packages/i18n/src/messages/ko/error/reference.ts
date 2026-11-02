import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "코드: {code}",
  "error.reference.copy": "오류 코드 복사",
  "error.reference.copied": "오류 코드를 복사했어요",
} as const satisfies PartialTranslation<typeof source>;
