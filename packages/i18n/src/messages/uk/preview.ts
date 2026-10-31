import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Перегляд файлу",
  "preview.panel.resize": "Змінити розмір перегляду файлу",
  "preview.panel.copy": "Копіювати текст файлу",
  "preview.panel.openExternally": "Відкрити файл у зовнішній програмі",
  "preview.panel.download": "Завантажити файл",
  "preview.panel.reveal": "Показати файл у Finder",
  "preview.panel.close": "Закрити перегляд файлу",
  "preview.panel.back": "Назад",
  "preview.panel.rawMarkdown": "Показати вихідний Markdown",
  "preview.panel.rawHtml": "Показати вихідний HTML",
  "preview.panel.wrapLines": "Переносити довгі рядки",
  "preview.folder.empty": "Ця папка порожня.",
  "preview.folder.truncated": "Показано лише перші {limit} елементів.",
  "preview.truncated": "Перегляд обрізано після {limit} символів.",
  "preview.unavailable": "Перегляд недоступний.",
  "preview.unsupported.title": "Перегляд недоступний",
  "preview.unsupported.description": "Файл цього типу можна відкрити в програмі за замовчуванням.",
  "preview.unsupported.openExternally": "Відкрити в іншій програмі",
  "preview.spreadsheet.readFailed": "Не вдалося прочитати цю таблицю.",
  "preview.spreadsheet.truncated": "Перегляд обмежено першими {rows} рядками та {columns} стовпцями.",
} as const satisfies PartialTranslation<typeof source>;
