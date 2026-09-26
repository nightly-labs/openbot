import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "このサーバーはストレージに対応していません。",
  "error.storage.agentMissing": "エージェントが存在しません。",
} as const satisfies PartialTranslation<typeof source>;
