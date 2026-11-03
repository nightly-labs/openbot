import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Таблиці",
  "sharedTable.description":
    "Що агенти зберігають між завданнями, із зазначенням агента, який почав кожен набір записів",
  "sharedTable.close": "Закрити таблиці",
  "sharedTable.loading": "Завантаження таблиць…",
  "sharedTable.empty":
    "Таблиць поки що немає. Агент створює таблицю сам, коли завданню потрібні записи між ходами, і нею може користуватися будь-який агент.",
  "sharedTable.loadFailed": "Не вдалося завантажити таблиці.",
  "sharedTable.deleteFailed": "Не вдалося це видалити.",
  "sharedTable.madeOutside": "Створено поза OpenBot · будь-який агент може видалити",
  "sharedTable.keptBy": "Зберігає {name}",
  "sharedTable.keptByDeleted": "Зберігає агент, якого вже немає",
  "sharedTable.deleteName": "Видалити {name}",
  "sharedTable.confirmDelete": "Видалити це для всіх агентів? Записи не можна буде відновити.",
  "sharedTable.notCounted": "не підраховано",
  "sharedTable.records": {
    one: "{count} запис",
    few: "{count} записи",
    many: "{count} записів",
    other: "{count} запису",
  },
} as const satisfies PartialTranslation<typeof source>;
