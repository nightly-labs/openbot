import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "У зовнішньому браузері можна відкривати лише посилання HTTP(S).",
  "error.app.notificationsUnsupported": "Ця система не підтримує сповіщення на робочому столі.",
  "error.app.notificationSettingsMissing": "У цій системі немає сторінки налаштувань сповіщень.",
  "error.app.notReady": "OpenBot не готовий.",
  "error.app.macSecureStorageUnavailable": "Захищене сховище macOS недоступне.",
  "error.app.secretStorageUnavailable": "Системне сховище секретів недоступне.",
  "error.app.remoteIdentityUnavailable": "Ідентифікаційні дані віддаленого хоста недоступні.",
  "error.app.iceServersMissing": "Remote Signal ще не надав ICE-сервери.",
  "error.app.finishLocalTest": "Завершіть локальну перевірку, перш ніж перемикати екрани.",
} as const satisfies PartialTranslation<typeof source>;
