import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Очистить поиск",
  "mobile.search.emptyTitle": "Ничего не найдено",
  "mobile.search.emptyBody": "Попробуйте другой запрос.",
  "mobile.search.searching": "Поиск сообщений…",
  "mobile.search.errorTitle": "Не удалось выполнить поиск",
  "mobile.search.errorBody": "Проверьте подключение к этому компьютеру и повторите попытку.",
  "mobile.search.retry": "Повторить",
  "mobile.search.showMore": "Показать ещё",
  "mobile.search.fromYou": "Вы → {name} · {time}",
  "mobile.search.toYou": "{name} → вам · {time}",
} as const satisfies PartialTranslation<typeof source>;
