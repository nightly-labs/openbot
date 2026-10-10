import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Просмотр файла",
  "preview.panel.resize": "Изменить размер просмотра файла",
  "preview.panel.copy": "Копировать текст файла",
  "preview.panel.openExternally": "Открыть файл во внешней программе",
  "preview.panel.download": "Скачать файл",
  "preview.panel.reveal": "Показать файл в Finder",
  "preview.panel.close": "Закрыть просмотр файла",
  "preview.panel.back": "Назад",
  "preview.panel.rawMarkdown": "Показать исходный Markdown",
  "preview.panel.rawHtml": "Показать исходный HTML",
  "preview.folder.empty": "Эта папка пуста.",
  "preview.folder.truncated": "Показаны только первые {limit} элементов.",
  "preview.truncated": "Просмотр обрезан после {limit} символов.",
  "preview.unavailable": "Просмотр недоступен.",
  "preview.unsupported.title": "Просмотр недоступен",
  "preview.unsupported.description": "Файл этого типа можно открыть в программе по умолчанию.",
  "preview.unsupported.openExternally": "Открыть во внешней программе",
  "preview.spreadsheet.readFailed": "Не удалось прочитать эту таблицу.",
  "preview.spreadsheet.truncated": "Просмотр ограничен первыми {rows} строками и {columns} столбцами.",
} as const satisfies PartialTranslation<typeof source>;
