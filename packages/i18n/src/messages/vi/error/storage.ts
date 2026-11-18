import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Máy chủ này không hỗ trợ lưu trữ.",
  "error.storage.agentMissing": "Agent không tồn tại.",
  "error.storage.unreadableFile": "OpenBot không đọc được {path}. Tệp đã bị hỏng.",
} as const satisfies PartialTranslation<typeof source>;
