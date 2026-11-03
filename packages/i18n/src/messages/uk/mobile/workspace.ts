import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Немає з’єднання",
  "mobile.workspace.status.online": "У мережі",
  "mobile.workspace.status.offline": "Не в мережі",
  "mobile.workspace.status.error": "Помилка з’єднання",
  "mobile.workspace.status.reconnecting": "Повторне з’єднання",
  "mobile.workspace.status.attempt": "Спроба {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Спроба ",
  "mobile.workspace.status.retryIn": "Повтор через {seconds} с",
  "mobile.workspace.section.agents": "Агенти",
  "mobile.workspace.error.directoryUnavailable": "Каталог сервера недоступний.",
  "mobile.workspace.error.sectionsLoadFailed": "Не вдалося завантажити розділи. Спробуйте ще раз.",
  "mobile.workspace.error.transportNotReady": "Мобільний транспорт не готовий.",
  "mobile.workspace.error.sectionsUnsupported": "Цей хост не підтримує зміну розділів.",
  "mobile.workspace.error.leaveOwnServer": "Вийти можна лише з віддалених серверів, до яких ви приєдналися.",
  "mobile.workspace.error.removeOwnedServerOnly": "Видалити цей сервер може лише власник.",
  "mobile.workspace.error.agentNotOnHost": "Агента немає на цьому хості.",
  "mobile.workspace.error.filesUnsupported": "Цей хост не підтримує керування файлами. Оновіть OpenBot на хості.",
  "mobile.workspace.error.agentUnavailableOnHost": "Агент недоступний на цьому хості.",
  "mobile.workspace.error.agentUnavailable": "Агент недоступний.",
  "mobile.workspace.error.formUnavailable": "Ця форма більше недоступна.",
  "mobile.workspace.error.approvalInactive":
    "Цей запит більше не чекає на відповідь. Інший пристрій уже відповів, або завдання зупинилося.",
  "mobile.workspace.error.approvalOffline": "Під’єднайтеся до сервера, щоб відповісти на цей запит.",
  "mobile.workspace.alert.preferencesTitle": "Не вдалося зберегти налаштування чату",
  "mobile.workspace.alert.preferencesBody": "Попередні налаштування збережено. Спробуйте ще раз.",
  "mobile.workspace.alert.updateRequiredTitle": "Потрібне оновлення",
  "mobile.workspace.alert.updateRequiredUnread":
    "Оновіть цей сервер на комп’ютері, щоб позначати розмови непрочитаними.",
  "mobile.workspace.alert.markUnreadTitle": "Не вдалося позначити непрочитаним",
  "mobile.workspace.alert.markUnreadBody": "Під’єднайтеся до сервера знову й спробуйте ще раз.",
  "mobile.workspace.alert.markAllReadTitle": "Не вдалося позначити все прочитаним",
  "mobile.workspace.alert.markAllReadBody":
    "Деякі чати залишилися непрочитаними. Під’єднайтеся до сервера знову й спробуйте ще раз.",
  "mobile.workspace.alert.serverOrderTitle": "Не вдалося зберегти порядок серверів",
  "mobile.workspace.alert.serverOrderBody": "Попередній порядок збережено. Спробуйте ще раз.",
  "mobile.workspace.error.connectFailed": "Не вдалося під’єднатися до сервера.",
  "mobile.workspace.error.disconnectFailed": "Сервер від’єднався некоректно.",
  "mobile.workspace.error.queueEditRejected": "Хост не прийняв цю зміну.",
} as const satisfies PartialTranslation<typeof source>;
