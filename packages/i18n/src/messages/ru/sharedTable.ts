import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Таблицы",
  "sharedTable.description": "Что агенты хранят между задачами, с указанием агента, начавшего каждый набор записей",
  "sharedTable.close": "Закрыть таблицы",
  "sharedTable.loading": "Загрузка таблиц…",
  "sharedTable.empty":
    "Таблиц пока нет. Агент создаёт её сам, когда задаче нужны записи между ходами, и ею может пользоваться любой агент.",
  "sharedTable.loadFailed": "Не удалось загрузить таблицы.",
  "sharedTable.deleteFailed": "Не удалось удалить это.",
  "sharedTable.madeOutside": "Создано вне OpenBot · любой агент может удалить",
  "sharedTable.keptBy": "Хранит {name}",
  "sharedTable.keptByDeleted": "Хранит агент, которого больше нет",
  "sharedTable.deleteName": "Удалить {name}",
  "sharedTable.confirmDelete": "Удалить это для всех агентов? Записи нельзя будет восстановить.",
  "sharedTable.notCounted": "не подсчитано",
  "sharedTable.records": {
    one: "{count} запись",
    few: "{count} записи",
    many: "{count} записей",
    other: "{count} записи",
  },
} as const satisfies PartialTranslation<typeof source>;
