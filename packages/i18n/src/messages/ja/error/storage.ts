import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "このサーバーはストレージに対応していません。",
  "error.storage.agentMissing": "エージェントが存在しません。",
  "error.storage.unreadableFile": "OpenBot は {path} を読み取れません。ファイルが破損しています。",
} as const satisfies PartialTranslation<typeof source>;
