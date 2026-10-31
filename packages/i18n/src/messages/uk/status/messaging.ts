import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

// Not translated yet: the screen shows the English text.
export const messages = {
  "status.messaging.working": "Уже працюю…",
  "status.messaging.queued": "Очікування: OpenBot зайнятий іншим запитом. Відповідь надійде сюди.",
  "status.messaging.busy": "У черзі забагато запитів. Спробуйте пізніше.",
  "status.messaging.failed": "OpenBot не зміг завершити цей запит. Подробиці — на хості OpenBot.",
  "status.messaging.noAnswer": "OpenBot завершив роботу без письмової відповіді.",
  "status.messaging.noAgent": "Поки що немає агента, який міг би тут відповісти. Додайте Оркестратора Slack в OpenBot.",
  "status.messaging.delegated": "Над цим працює один з агентів. Відповідь надійде сюди.",
  "status.messaging.stopped": "Зупинено.",
  "status.messaging.stop": "Зупинити",
  "status.messaging.approvalTitle": "OpenBot просить підтвердження, щоб продовжити.",
  "status.messaging.approvalCommand": "Виконати команду",
  "status.messaging.approvalFileChange": "Змінити файли",
  "status.messaging.approvalPermissions": "Отримати додаткові дозволи",
  "status.messaging.approve": "Схвалити",
  "status.messaging.deny": "Відхилити",
  "status.messaging.approvedBy": "Схвалено: {user}.",
  "status.messaging.deniedBy": "Відхилено: {user}.",
  "status.messaging.answeredOnHost": "Відповідь надано на хості OpenBot.",
  "status.messaging.requestInactive": "Цей запит більше не активний.",
  "status.messaging.onlyRequester": "Це може зробити лише {user}. Відповісти також може хост OpenBot.",
  "status.messaging.hostOnly": "На цей запит може відповісти лише хост OpenBot.",
  "status.messaging.filesSkipped": "Деякі файли не надіслано: {names}.",
  "status.messaging.orchestratorName": "Оркестратор Slack",
  "status.messaging.orchestratorTitle": "Відповідає в Slack і звертається до команди",
  "status.messaging.discordNoAgent":
    "Поки що немає агента, який міг би тут відповісти. Додайте Оркестратора Discord в OpenBot.",
  "status.messaging.discordOrchestratorName": "Оркестратор Discord",
  "status.messaging.discordOrchestratorTitle": "Відповідає в Discord і звертається до команди",
  "status.messaging.integrationsSection": "Інтеграції",
  "status.messaging.signInReceived": "OpenBot отримав дані про встановлення Slack. Цю вкладку можна закрити.",
  "status.messaging.signInUnknown": "OpenBot не починав цього встановлення Slack. Почніть його знову в OpenBot.",
  "status.messaging.telegramNoAgent":
    "Поки що немає агента, який міг би тут відповісти. Додайте Оркестратора Telegram в OpenBot.",
  "status.messaging.telegramLinked":
    "OpenBot під’єднано до цього чату. Згадайте {bot} або дайте відповідь на повідомлення OpenBot, щоб звернутися до агентів.",
  "status.messaging.telegramOrchestratorName": "Оркестратор Telegram",
  "status.messaging.telegramOrchestratorTitle": "Відповідає в Telegram і звертається до команди",
} as const satisfies PartialTranslation<typeof source>;
