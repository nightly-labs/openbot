import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Не вдалося змінити тариф сервера. Оновіть розділ «Оплата» і спробуйте ще раз.",
  "error.billing.confirmMismatch": "Введіть назву сервера, щоб видалити його.",
  "error.billing.restartBusy": "Зараз сервер не можна перезапустити. Спробуйте ще раз за хвилину.",
  "error.billing.planRequired": "Тариф цього сервера закінчився. Продовжте його, щоб запустити сервер.",
  "error.billing.planSoldOut": "Цей тариф розпродано. Виберіть інший тариф.",
  "error.billing.licenseExists": "Цей обліковий запис уже має ліцензію. Натомість змініть кількість її користувачів.",
  "error.billing.licenseCurrency": "Ліцензія має використовувати валюту ваших інших тарифів.",
  "error.billing.licenseUsersInUse": "Ліцензія не може мати менше користувачів, ніж людей, які зараз нею користуються.",
  "error.billing.licensePaymentFailed":
    "Не вдалося оплатити доданих користувачів. Оновіть спосіб оплати і спробуйте ще раз.",
  "error.billing.licenseUnavailable": "Ліцензії зараз недоступні.",
  "error.billing.noLicense": "Цей обліковий запис не має ліцензії.",
  "error.billing.invalidRequest": "Некоректний запит оплати.",
  "error.billing.invalidResponse": "Некоректна відповідь оплати.",
  "error.billing.notStripePage": "Сторінка оплати не належить Stripe.",
} as const satisfies PartialTranslation<typeof source>;
