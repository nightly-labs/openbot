import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot не удалось запустить",
  "startup.failedBody":
    "{message}\n\nЛокальные данные не сброшены и не перезаписаны. Шаги восстановления — в руководстве по устранению неполадок.",
  "startup.archiveChangedTitle": "Файлы OpenBot изменены",
  "startup.archiveChangedBody":
    "Другая программа изменила файл OpenBot app.asar. Сейчас OpenBot работает, но после выхода он больше не запустится.\n\nЧтобы исправить это, установите OpenBot заново. Ваши локальные данные сохранятся.",
  "startup.archiveChangedDownload": "Скачать OpenBot",
} as const satisfies PartialTranslation<typeof source>;
