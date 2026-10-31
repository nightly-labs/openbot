import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Вкладення не знайдено.",
  "error.attachment.fileTooLarge": "Файл перевищує ліміт 100 МБ.",
  "error.attachment.totalTooLarge": "Вкладення перевищують загальний ліміт 250 МБ.",
  "error.attachment.unavailable": "Цей файл більше недоступний.",
  "error.attachment.tooMany": "Виберіть не більше ніж {limit} файлів.",
  "error.attachment.mediaUnsupported":
    "Цей сервер не підтримує вкладення MP3 і MOV. Оновіть OpenBot на хості й повторіть спробу.",
  "error.attachment.emlUnsupported":
    "Цей сервер не підтримує вкладення EML. Оновіть OpenBot на хості й повторіть спробу.",
  "error.attachment.zipUnsupported":
    "Цей сервер не підтримує вкладення ZIP. Оновіть OpenBot на хості й повторіть спробу.",
  "error.attachment.mp4Unsupported":
    "Цей сервер не підтримує вкладення MP4. Оновіть OpenBot на хості й повторіть спробу.",
  "error.attachment.previewTooLarge": "Файл перевищує ліміт 100 МБ.",
} as const satisfies PartialTranslation<typeof source>;
