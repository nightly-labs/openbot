import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Открыть файл",
  "attachment.preview": "Предпросмотр: {name}",
  "attachment.notFound": "Файл не найден",
  "attachment.download": "Скачать {name}",
  "attachment.open": "Открыть {name}",
  "attachment.loadMedia": "Воспроизвести {name}",
  "attachment.previewUnavailable": "Предпросмотр недоступен.",
  "attachment.error.preview": "Не удалось показать предпросмотр {name}. Повторите.",
  "attachment.error.download": "Не удалось скачать вложения. Повторите.",
  "attachment.error.open": "Не удалось открыть или сохранить это вложение. Повторите.",
  "attachment.error.openFile": "Не удалось открыть этот файл. Повторите.",
  "attachment.error.fileFallback": "Файл",
  "attachment.error.fileNotFound": "Файл «{name}» не найден по этому пути. Возможно, его переместили или удалили.",
  "attachment.error.previewFile": "Не удалось показать предпросмотр «{name}». Повторите.",
} as const satisfies PartialTranslation<typeof source>;
