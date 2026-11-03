import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Цей сервер не підтримує сховище.",
  "error.storage.agentMissing": "Агента не існує.",
  "error.storage.unreadableFile": "OpenBot не може прочитати {path}. Файл пошкоджено.",
} as const satisfies PartialTranslation<typeof source>;
