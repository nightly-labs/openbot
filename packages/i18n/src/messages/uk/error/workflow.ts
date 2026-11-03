import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Цього робочого процесу більше не існує.",
  "error.workflow.versionMissing": "Цієї версії робочого процесу більше не існує.",
  "error.workflow.annotation": "Текст, нотатки й фігури не можуть мати зв’язків.",
  "error.workflow.port": "Крок не може приймати такий тип вхідних даних.",
  "error.workflow.branch": "Лише умова може мати зв’язки «так» і «ні».",
  "error.workflow.conditionBranch": "Кожен зв’язок від умови має бути «так» або «ні».",
  "error.workflow.duplicateEdge": "Ці два кроки вже мають такий зв’язок.",
  "error.workflow.serverTooOld":
    "Цей сервер не підтримує робочі процеси. Оновіть OpenBot на комп’ютері, де він працює.",
  "error.workflow.nodeUnsupported":
    "Ця версія OpenBot поки не може виконувати кроки із зображеннями, файлами й повідомленнями.",
  "error.workflow.interrupted": "OpenBot зупинився під час цього кроку. Запустіть його знову.",
  "error.workflow.agentMissing": "Виберіть агента для цього кроку.",
  "error.workflow.handoffFailed": "OpenBot не вдалося передати цей крок агенту.",
  "error.workflow.agentStepEnded": "Повідомлення агента для цього кроку видалено до його відповіді.",
  "error.workflow.conditionUnclear": "Модель не відповіла «так» або «ні».",
  "error.workflow.modelFailed": "Модель не змогла відповісти. Запустіть крок знову.",
  "error.workflow.modelBusy": "Виконується інший запит до моделі. Незабаром запустіть крок знову.",
  "error.workflow.stepMissing": "Цього кроку більше не існує.",
  "error.workflow.nodeMissing": "Цього кроку немає в робочому процесі.",
  "error.workflow.runMissing": "Цього запуску більше не існує.",
  "error.workflow.notRetryable": "Знову можна запустити лише крок, який завершився помилкою або був зупинений.",
  "error.workflow.noDecision": "Цей крок не очікує рішення.",
  "error.workflow.outputPlaceMissing": "Виберіть місце в месенджері для цього виводу.",
  "error.workflow.outputConnectionOff":
    "Під’єднання месенджера для цього виводу вимкнено або видалено. Виберіть місце знову.",
  "error.workflow.outputNotRunning": "Під’єднання месенджера зараз не працює. Спробуйте ще раз, коли воно запрацює.",
  "error.workflow.outputRefused": "Місце відхилило публікацію. Переконайтеся, що OpenBot може публікувати там.",
  "error.workflow.outputUncertain":
    "Надсилання публікації перервалося. Частина її може бути в цьому місці. Перевірте це місце, перш ніж повторювати.",
  "error.workflow.tooLarge":
    "Цей робочий процес завеликий для збереження. Видаліть деякі малюнки або довгі тексти і спробуйте ще раз.",
  "error.workflow.tooLargeToSend":
    "Цей робочий процес завеликий, щоб надіслати його на інший комп’ютер. Відкрийте його на комп’ютері, де працює сервер.",
  "error.workflow.webhookMissing": "Цей крок не є тригером вебхука. Збережіть робочий процес і спробуйте ще раз.",
} as const satisfies PartialTranslation<typeof source>;
