import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "該伺服器不支援儲存功能。",
  "error.storage.agentMissing": "該助理不存在。",
  "error.storage.unreadableFile": "OpenBot 無法讀取 {path}，該檔案已損壞。",
} as const satisfies PartialTranslation<typeof source>;
