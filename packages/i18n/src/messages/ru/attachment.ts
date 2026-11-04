import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Открыть файл",
  "attachment.preview": "Предпросмотр: {name}",
  "attachment.notFound": "Файл не найден",
  "attachment.download": "Скачать {name}",
  "attachment.downloadProgress": "{received} из {total}",
  "attachment.stopDownload": "Остановить скачивание {name}, {percent} %",
  "attachment.downloadFailed": "Не удалось скачать",
  "attachment.retryDownload": "Повторить скачивание {name}",
  "attachment.open": "Открыть {name}",
  "attachment.loadMedia": "Воспроизвести {name}",
  "attachment.previewUnavailable": "Предпросмотр недоступен.",
  "attachment.error.preview": "Не удалось показать предпросмотр «{name}». Повторите попытку.",
  "attachment.error.download": "Не удалось скачать вложения. Повторите попытку.",
  "attachment.error.open": "Не удалось открыть или сохранить это вложение. Повторите попытку.",
  "attachment.error.openFile": "Не удалось открыть этот файл. Повторите попытку.",
  "attachment.error.fileFallback": "Файл",
  "attachment.error.fileNotFound": "Файл «{name}» не найден по этому пути. Возможно, его переместили или удалили.",
  "attachment.error.previewFile": "Не удалось показать предпросмотр «{name}». Повторите попытку.",
} as const satisfies PartialTranslation<typeof source>;
