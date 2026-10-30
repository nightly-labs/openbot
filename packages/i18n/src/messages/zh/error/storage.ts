import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "该服务器不支持存储功能。",
  "error.storage.agentMissing": "该助手不存在。",
  "error.storage.unreadableFile": "OpenBot 无法读取 {path}，该文件已损坏。",
} as const satisfies PartialTranslation<typeof source>;
