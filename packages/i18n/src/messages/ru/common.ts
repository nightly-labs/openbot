import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.close": "Закрыть",
  "common.delete": "Удалить",
  "common.remove": "Убрать",
  "common.edit": "Изменить",
  "common.rename": "Переименовать",
  "common.retry": "Повторить",
  "common.copy": "Копировать",
  "common.copied": "Скопировано",
  "common.done": "Готово",
  "common.back": "Назад",
  "common.continue": "Продолжить",
  "common.add": "Добавить",
  "common.create": "Создать",
  "common.open": "Открыть",
  "common.search": "Поиск",
  "common.loading": "Загрузка…",
  "common.saving": "Сохранение…",
  "common.tryAgain": "Повторить",
  "common.connecting": "Подключение…",
  "common.download": "Скачать",
  "common.removing": "Удаление…",
  "common.sending": "Отправка…",
} as const satisfies PartialTranslation<typeof source>;
