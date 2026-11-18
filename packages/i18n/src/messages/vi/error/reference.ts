import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/reference";

export const messages = {
  "error.reference.label": "Mã: {code}",
  "error.reference.copy": "Sao chép mã lỗi",
  "error.reference.copied": "Đã sao chép mã lỗi",
} as const satisfies PartialTranslation<typeof source>;
