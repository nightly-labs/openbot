import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Потрібна ваша відповідь.",
  "notification.needsApproval": "Потрібне ваше підтвердження.",
  "notification.needsBrowserStep": "Потрібно, щоб ви завершили крок у браузері.",
  "notification.needsApprovalFor": "Потрібне ваше підтвердження: {action}",
  "notification.finished": "Роботу завершено.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Крок чекає на ваше схвалення.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Робочий процес має новий результат.",
  "notification.failed": "Зупинено через помилку.",
  "notification.channelTitle": "{agent} у каналі {channel}",
  "notification.channelMessage": "Надіслано повідомлення.",
  "notification.usageLimit.title": "Обліковий запис {provider} досяг ліміту",
  "notification.usageLimit.body": {
    one: "Чекає {count} агент. OpenBot спробує знову пізніше.",
    few: "Чекають {count} агенти. OpenBot спробує знову пізніше.",
    many: "Чекають {count} агентів. OpenBot спробує знову пізніше.",
    other: "Чекає {count} агента. OpenBot спробує знову пізніше.",
  },
  "notification.usageLimit.bodyResets": {
    one: "Чекає {count} агент. Скидання {reset}.",
    few: "Чекають {count} агенти. Скидання {reset}.",
    many: "Чекають {count} агентів. Скидання {reset}.",
    other: "Чекає {count} агента. Скидання {reset}.",
  },
  "notification.test": "Сповіщення працюють.",
  "notification.welcome": "OpenBot повідомить тут, коли ви знадобитеся агенту.",
  "notification.toast.region": "Сповіщення",
  "notification.toast.close": "Закрити сповіщення",
} as const satisfies PartialTranslation<typeof source>;
