import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "هذا الخادم لا يدعم التخزين.",
  "error.storage.agentMissing": "الوكيل غير موجود.",
  "error.storage.unreadableFile": "لا يمكن لـ OpenBot قراءة {path}. الملف تالف.",
} as const satisfies PartialTranslation<typeof source>;
