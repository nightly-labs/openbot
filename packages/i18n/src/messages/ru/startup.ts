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
  "startup.recoveryWindowTitle": "Восстановление OpenBot",
  "startup.recoveryTitle": "OpenBot не открылся",
  "startup.recoveryBody": {
    one: "OpenBot {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    few: "OpenBot {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    many: "OpenBot {version} остановился до открытия {count} раз подряд. Ваши локальные данные не сброшены и не перезаписаны.",
    other:
      "OpenBot {version} остановился до открытия {count} раза подряд. Ваши локальные данные не сброшены и не перезаписаны.",
  },
  "startup.recoveryHint":
    "Попробуйте снова или установите последнюю версию, которая открывалась. Чтобы получить помощь, экспортируйте диагностику и отправьте файл вместе с отчётом.",
  "startup.recoveryRetry": "Повторить",
  "startup.recoveryPreviousVersion": "Скачать прошлую версию",
  "startup.recoveryExportDiagnostics": "Экспорт диагностики",
  "startup.recoveryOpenDataFolder": "Открыть папку данных",
  "startup.recoveryQuit": "Выйти",
  "startup.recoveryDiagnosticsSaved": "Файл диагностики сохранён.",
  "startup.recoveryActionFailed": "OpenBot не удалось выполнить это действие.",
} as const satisfies PartialTranslation<typeof source>;
