import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.answered": "Отвечено",
  "uiBlock.status.waiting": "Ждём вас",
  "uiBlock.outcome.expired": "Ответ не пришёл вовремя",
  "uiBlock.outcome.closed": "Закрыто без ответа",
  "uiBlock.outcome.autoAnswered": "{outcome} (никто не ответил вовремя)",
  "uiBlock.confirm.holdHint": "Удерживайте кнопку, чтобы подтвердить, или нажмите её и подтвердите на следующем шаге",
  "uiBlock.confirm.prompt": "Подтвердить: {action}?",
  "uiBlock.confirm.accept": "Подтвердить",
  "uiBlock.confirm.autoActionLabel": "{action} · {seconds} с",
  "uiBlock.confirm.autoActionClock": "{action} · {time}",
  "uiBlock.confirm.previewLabel": "Предпросмотр",
  "uiBlock.confirm.showFullPreview": "Показать всё",
  "uiBlock.confirm.hideFullPreview": "Свернуть",
  "uiBlock.choice.submit": "Отправить",
  "uiBlock.choice.shortcutHint": "Нажмите {first}–{last}, чтобы выбрать",
  "uiBlock.quick.label": "Быстрые ответы",
  "uiBlock.form.submit": "Отправить",
  "uiBlock.form.required": "Заполните это поле",
  "uiBlock.form.choose": "Выберите вариант",
  "uiBlock.form.notSet": "Не указано",
  "uiBlock.form.invalid": "Некоторые ответы указаны неверно. Проверьте их и попробуйте снова.",
  "uiBlock.form.hiddenValue": "Скрыто",
  "uiBlock.skip": "Пропустить",
  "uiBlock.error.answerFailed": "Не удалось отправить ответ. Попробуйте ещё раз.",
} as const satisfies PartialTranslation<typeof source>;
