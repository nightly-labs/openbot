import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Нет подключения",
  "mobile.workspace.status.online": "В сети",
  "mobile.workspace.status.offline": "Не в сети",
  "mobile.workspace.status.error": "Ошибка подключения",
  "mobile.workspace.status.reconnecting": "Переподключение",
  "mobile.workspace.status.attempt": "Попытка {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Попытка ",
  "mobile.workspace.status.retryIn": "Повтор через {seconds} с",
  "mobile.workspace.section.agents": "Агенты",
  "mobile.workspace.error.directoryUnavailable": "Каталог сервера недоступен.",
  "mobile.workspace.error.sectionsLoadFailed": "Не удалось загрузить разделы. Повторите попытку.",
  "mobile.workspace.error.transportNotReady": "Мобильный транспорт не готов.",
  "mobile.workspace.error.sectionsUnsupported": "Этот хост не поддерживает изменение разделов.",
  "mobile.workspace.error.leaveOwnServer": "Выйти можно только с подключённых удалённых серверов.",
  "mobile.workspace.error.agentNotOnHost": "Агента нет на этом хосте.",
  "mobile.workspace.error.filesUnsupported": "Этот хост не поддерживает управление файлами. Обновите OpenBot на хосте.",
  "mobile.workspace.error.agentUnavailableOnHost": "Агент недоступен на этом хосте.",
  "mobile.workspace.error.agentUnavailable": "Агент недоступен.",
  "mobile.workspace.error.formUnavailable": "Эта форма больше недоступна.",
  "mobile.workspace.error.approvalInactive":
    "Этот запрос больше не ждёт ответа. Другое устройство уже ответило, или задача остановилась.",
  "mobile.workspace.error.approvalOffline": "Подключитесь к серверу, чтобы ответить на этот запрос.",
  "mobile.workspace.alert.preferencesTitle": "Не удалось сохранить настройки чата",
  "mobile.workspace.alert.preferencesBody": "Прежние настройки сохранены. Повторите попытку.",
  "mobile.workspace.alert.updateRequiredTitle": "Нужно обновление",
  "mobile.workspace.alert.updateRequiredUnread":
    "Обновите этот настольный сервер, чтобы помечать диалоги непрочитанными.",
  "mobile.workspace.alert.markUnreadTitle": "Не удалось пометить непрочитанным",
  "mobile.workspace.alert.markUnreadBody": "Переподключитесь к серверу и повторите попытку.",
  "mobile.workspace.alert.serverOrderTitle": "Не удалось сохранить порядок серверов",
  "mobile.workspace.alert.serverOrderBody": "Прежний порядок сохранён. Повторите попытку.",
  "mobile.workspace.error.connectFailed": "Не удалось подключиться к серверу.",
  "mobile.workspace.error.disconnectFailed": "Сервер отключился некорректно.",
  "mobile.workspace.error.queueEditRejected": "Хост не принял это изменение.",
} as const satisfies PartialTranslation<typeof source>;
