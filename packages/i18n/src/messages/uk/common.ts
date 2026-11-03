import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Скасувати",
  "common.save": "Зберегти",
  "common.close": "Закрити",
  "common.delete": "Видалити",
  "common.remove": "Прибрати",
  "common.edit": "Змінити",
  "common.rename": "Перейменувати",
  "common.retry": "Повторити",
  "common.copy": "Копіювати",
  "common.copied": "Скопійовано",
  "common.done": "Готово",
  "common.back": "Назад",
  "common.continue": "Продовжити",
  "common.add": "Додати",
  "common.create": "Створити",
  "common.open": "Відкрити",
  "common.search": "Пошук",
  "common.loading": "Завантаження…",
  "common.saving": "Збереження…",
  "common.tryAgain": "Повторити",
  "common.connecting": "Під’єднання…",
  "common.download": "Завантажити",
  "common.removing": "Видалення…",
  "common.sending": "Надсилання…",
} as const satisfies PartialTranslation<typeof source>;
