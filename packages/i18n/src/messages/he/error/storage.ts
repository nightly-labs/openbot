import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "השרת הזה אינו תומך באחסון.",
  "error.storage.agentMissing": "הסוכן אינו קיים.",
  "error.storage.unreadableFile": "OpenBot לא יכול לקרוא את {path}. הקובץ פגום.",
} as const satisfies PartialTranslation<typeof source>;
