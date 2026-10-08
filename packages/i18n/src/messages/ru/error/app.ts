import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Во внешнем браузере можно открывать только ссылки HTTP(S).",
  "error.app.notificationsUnsupported": "Эта система не поддерживает уведомления на рабочем столе.",
  "error.app.notificationSettingsMissing": "В этой системе нет страницы настроек уведомлений.",
  "error.app.notReady": "OpenBot не готов.",
  "error.app.macSecureStorageUnavailable": "Защищённое хранилище macOS недоступно.",
  "error.app.secretStorageUnavailable": "Системное хранилище секретов недоступно.",
  "error.app.remoteIdentityUnavailable": "Идентификатор удалённого хоста недоступен.",
  "error.app.iceServersMissing": "Remote Signal ещё не передал ICE-серверы.",
  "error.app.finishLocalTest": "Завершите локальную проверку, прежде чем переключать экраны.",
} as const satisfies PartialTranslation<typeof source>;
