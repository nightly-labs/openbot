import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "Máy chủ này không hỗ trợ lưu trữ.",
  "error.storage.agentMissing": "Trợ lý không tồn tại.",
  "error.storage.unreadableFile": "OpenBot không thể đọc {path}. Tệp bị hỏng.",
} as const satisfies PartialTranslation<typeof source>;
