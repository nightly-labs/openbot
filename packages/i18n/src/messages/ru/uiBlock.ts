import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.pending": "Нужен ваш ответ",
  "uiBlock.status.answered": "Отвечено",
  "uiBlock.status.expired": "Время вышло",
  "uiBlock.status.closed": "Закрыто",
  "uiBlock.outcome.expired": "Ответ не пришёл вовремя",
  "uiBlock.outcome.closed": "Закрыто без ответа",
  "uiBlock.confirm.holdHint": "Удерживайте кнопку, чтобы подтвердить, или нажмите её и подтвердите на следующем шаге",
  "uiBlock.confirm.prompt": "Подтвердить: {action}?",
  "uiBlock.confirm.accept": "Подтвердить",
  "uiBlock.confirm.previewLabel": "Предпросмотр",
  "uiBlock.choice.submit": "Отправить",
  "uiBlock.choice.shortcutHint": "Нажмите {first}–{last}, чтобы выбрать",
  "uiBlock.choice.selectedCount": {
    one: "Выбран {count}",
    few: "Выбрано {count}",
    many: "Выбрано {count}",
    other: "Выбрано {count}",
  },
  "uiBlock.choice.noneSelected": "Ничего не выбрано",
  "uiBlock.quick.label": "Быстрые ответы",
  "uiBlock.quick.textLabel": "Свой ответ",
  "uiBlock.quick.textPlaceholder": "Или напишите свой ответ",
  "uiBlock.quick.send": "Отправить",
  "uiBlock.form.submit": "Отправить",
  "uiBlock.form.required": "Заполните это поле",
  "uiBlock.form.choose": "Выберите вариант",
  "uiBlock.form.notSet": "Не указано",
  "uiBlock.skip": "Пропустить",
  "uiBlock.error.answerFailed": "Не удалось отправить ответ. Попробуйте ещё раз.",
} as const satisfies PartialTranslation<typeof source>;
