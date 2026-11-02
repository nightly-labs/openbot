import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Нужен ваш ответ.",
  "notification.needsApproval": "Нужно ваше подтверждение.",
  "notification.needsBrowserStep": "Нужно, чтобы вы завершили шаг в браузере.",
  "notification.needsApprovalFor": "Нужно ваше подтверждение: {action}",
  "notification.finished": "Работа завершена.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Шаг ждет вашего одобрения.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "У рабочего процесса есть новый результат.",
  "notification.failed": "Остановлено из-за ошибки.",
  "notification.channelTitle": "{agent} в канале {channel}",
  "notification.channelMessage": "Новое сообщение.",
  "notification.usageLimit.title": "Аккаунт {provider} достиг лимита",
  "notification.usageLimit.body": {
    one: "Ждёт {count} агент. OpenBot попробует позже.",
    few: "Ждут {count} агента. OpenBot попробует позже.",
    many: "Ждут {count} агентов. OpenBot попробует позже.",
    other: "Ждут {count} агента. OpenBot попробует позже.",
  },
  "notification.usageLimit.bodyResets": {
    one: "Ждёт {count} агент. Сброс {reset}.",
    few: "Ждут {count} агента. Сброс {reset}.",
    many: "Ждут {count} агентов. Сброс {reset}.",
    other: "Ждут {count} агента. Сброс {reset}.",
  },
  "notification.machineAlert.disk": "{server}: диск заполнен на {percent}",
  "notification.machineAlert.memory": "{server}: память занята на {percent}",
  "notification.machineAlert.cpu": "{server}: CPU загружен на {percent}",
  "notification.machineAlert.body": "Превышен порог оповещения {level}. См. «Настройки сервера» → «Хранилище».",
  "notification.test": "Уведомления работают.",
  "notification.welcome": "OpenBot сообщит здесь, когда вы понадобитесь агенту.",
  "notification.toast.region": "Уведомления",
  "notification.toast.close": "Закрыть уведомление",
} as const satisfies PartialTranslation<typeof source>;
