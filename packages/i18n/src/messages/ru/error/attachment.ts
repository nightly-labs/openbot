import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Вложение не найдено.",
  "error.attachment.fileTooLarge": "Файл превышает лимит 100 МБ.",
  "error.attachment.totalTooLarge": "Вложения превышают общий лимит 250 МБ.",
  "error.attachment.unavailable": "Этот файл больше недоступен.",
  "error.attachment.tooMany": "Выберите не более {limit} файлов.",
  "error.attachment.mediaUnsupported":
    "Этот сервер не поддерживает вложения MP3 и MOV. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.emlUnsupported":
    "Этот сервер не поддерживает вложения EML. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.zipUnsupported":
    "Этот сервер не поддерживает вложения ZIP. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.mp4Unsupported":
    "Этот сервер не поддерживает вложения MP4. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.previewTooLarge": "Файл превышает лимит 100 МБ.",
} as const satisfies PartialTranslation<typeof source>;
