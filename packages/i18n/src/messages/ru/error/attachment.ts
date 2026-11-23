import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Вложение не найдено.",
  "error.attachment.fileTooLarge": "Файл превышает лимит 100 МБ.",
  "error.attachment.namedFileTooLarge": "{name} превышает лимит 100 МБ.",
  "error.attachment.emptyFile":
    "Файл {name} пуст, или OpenBot не может его прочитать. Сохраните файл заново, затем прикрепите его снова.",
  "error.attachment.totalTooLarge": "Вложения превышают общий лимит 250 МБ.",
  "error.attachment.unavailable": "Этот файл больше недоступен.",
  "error.attachment.noApp":
    "Ни одно приложение на этом компьютере не открыло этот файл. Скачайте его, а затем откройте в файловом менеджере.",
  "error.attachment.tooMany": "Выберите не более {limit} файлов.",
  "error.attachment.mediaUnsupported":
    "Этот сервер не поддерживает вложения MP3 и MOV. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.emlUnsupported":
    "Этот сервер не поддерживает вложения EML. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.zipUnsupported":
    "Этот сервер не поддерживает вложения ZIP. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.mp4Unsupported":
    "Этот сервер не поддерживает вложения MP4. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.svgUnsupported":
    "Этот сервер не поддерживает вложения SVG. Обновите OpenBot на хосте и повторите попытку.",
  "error.attachment.previewTooLarge": "Файл превышает лимит 100 МБ.",
} as const satisfies PartialTranslation<typeof source>;
