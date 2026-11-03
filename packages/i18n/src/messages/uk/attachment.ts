import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Відкрити файл",
  "attachment.preview": "Переглянути {name}",
  "attachment.notFound": "Файл не знайдено",
  "attachment.download": "Завантажити {name}",
  "attachment.open": "Відкрити {name}",
  "attachment.loadMedia": "Відтворити {name}",
  "attachment.previewUnavailable": "Попередній перегляд недоступний.",
  "attachment.error.preview": "Не вдалося показати попередній перегляд «{name}». Спробуйте ще раз.",
  "attachment.error.download": "Не вдалося завантажити вкладення. Спробуйте ще раз.",
  "attachment.error.open": "Не вдалося відкрити або зберегти це вкладення. Спробуйте ще раз.",
  "attachment.error.openFile": "Не вдалося відкрити цей файл. Спробуйте ще раз.",
  "attachment.error.fileFallback": "Файл",
  "attachment.error.fileNotFound": "Файл «{name}» не знайдено за цим шляхом. Можливо, його перемістили або видалили.",
  "attachment.error.previewFile": "Не вдалося показати попередній перегляд «{name}». Спробуйте ще раз.",
} as const satisfies PartialTranslation<typeof source>;
