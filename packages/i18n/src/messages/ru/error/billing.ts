import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.invalidRequest": "Некорректный запрос оплаты.",
  "error.billing.invalidResponse": "Некорректный ответ оплаты.",
  "error.billing.notStripePage": "Страница оплаты не принадлежит Stripe.",
} as const satisfies PartialTranslation<typeof source>;
