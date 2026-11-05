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
  "startup.newerDataUpdatingTitle": "Обновление OpenBot",
  "startup.newerDataUpdatingBody":
    "Более новая версия OpenBot сохранила ваши данные. OpenBot устанавливает последнюю версию и затем откроется снова.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataTitle": "Установите последнюю версию OpenBot",
  "startup.newerDataBody":
    "Более новая версия OpenBot сохранила ваши данные, и эта версия ({version}) не может их открыть. Установите последнюю версию, чтобы открыть данные.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataDownload": "Скачать OpenBot",
  "startup.newerDataGuide": "Открыть руководство",
  "startup.newerDataQuit": "Выйти",
} as const satisfies PartialTranslation<typeof source>;
