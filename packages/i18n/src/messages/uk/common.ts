import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
	"common.cancel": "Скасувати",
	"common.save": "Зберегти",
	"common.close": "Закрити",
	"common.delete": "Видалити",
	"common.remove": "Вилучити",
	"common.edit": "Редагувати",
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
	"common.noMatches": "Нічого не знайдено",
	"common.loading": "Завантаження…",
	"common.saving": "Збереження…",
	"common.tryAgain": "Спробувати знову",
	"common.connecting": "Підключення…",
	"common.download": "Завантажити",
	"common.removing": "Вилучення…",
	"common.sending": "Надсилання…",
	"common.scrollLeft": "Прокрутити ліворуч",
	"common.scrollRight": "Прокрутити праворуч",
	"common.scrollUp": "Прокрутити вгору",
	"common.scrollDown": "Прокрутити вниз",
};


 as const satisfies PartialTranslation<typeof source>;
