import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Не удалось изменить тариф сервера. Обновите раздел «Оплата» и повторите попытку.",
  "error.billing.confirmMismatch": "Введите название сервера, чтобы удалить его.",
  "error.billing.invalidRequest": "Некорректный запрос оплаты.",
  "error.billing.invalidResponse": "Некорректный ответ оплаты.",
  "error.billing.notStripePage": "Страница оплаты не принадлежит Stripe.",
} as const satisfies PartialTranslation<typeof source>;
