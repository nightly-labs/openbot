import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Этот сервер не поддерживает хранилище.",
  "error.storage.agentMissing": "Агента не существует.",
  "error.storage.unreadableFile": "OpenBot не может прочитать {path}. Файл повреждён.",
} as const satisfies PartialTranslation<typeof source>;
