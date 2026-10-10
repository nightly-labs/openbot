import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Память",
  "memory.description": "Сохранённая память: {name}",
  "memory.add": "Добавить запись",
  "memory.close": "Закрыть память",
  "memory.new": "Новая запись",
  "memory.newPlaceholder": "Добавьте постоянный факт или предпочтение",
  "memory.save": "Сохранить запись",
  "memory.limitAgent":
    "У этого агента достигнут лимит записей в памяти: {limit}. Измените, объедините или удалите запись, прежде чем добавлять новую.",
  "memory.limitChannel":
    "В этом канале достигнут лимит записей в памяти: {limit}. Измените, объедините или удалите запись, прежде чем добавлять новую.",
  "memory.loading": "Загрузка памяти…",
  "memory.emptyAgent": "У этого агента пока нет сохранённой памяти.",
  "memory.emptyChannel": "В этом канале пока нет сохранённой памяти.",
  "memory.editText": "Изменить запись: {text}",
  "memory.edit": "Изменить запись",
  "memory.delete": "Удалить запись",
  "memory.learned": "Запомнено автоматически",
  "memory.manual": "Добавлено вручную",
  "memory.unknownDate": "Дата неизвестна",
  "memory.clearAll": "Очистить всю память",
  "memory.clearTitle": "Очистить всю память?",
  "memory.clearDescription":
    "OpenBot безвозвратно удалит все сохранённые записи ({total}) для {name}. Исходные сообщения останутся в истории диалога.",
  "memory.loadFailed": "Не удалось загрузить память.",
  "memory.saveFailed": "Не удалось сохранить запись.",
  "memory.updateFailed": "Не удалось обновить запись.",
  "memory.deleteFailed": "Не удалось удалить запись.",
  "memory.clearFailed": "Не удалось очистить память.",
  "memory.inclusion.label": "Использование памяти",
  "memory.inclusion.essential": "Всегда включать",
  "memory.inclusion.searchable": "Искать при необходимости",
  "memory.inclusion.automatic": "Решает агент",
  "memory.inclusion.userControlled": "Выбрано вами",
  "memory.inclusion.agentControlled": "Агент может это изменить",
  "memory.inclusion.explanation":
    "Все записи памяти сохраняются. В каждый промпт попадают только важные записи. Остальные агент может найти поиском.",
  "memory.inclusion.capacity": "Объём важной памяти: {used} из {total}",
} as const satisfies PartialTranslation<typeof source>;
