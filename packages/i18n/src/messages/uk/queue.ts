import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Черга повідомлень",
  "queue.moved": "Повідомлення з черги переміщено на позицію {position} з {total}.",
  "queue.attachment": "Вкладення",
  "queue.hold.named": "Очікування — {name} працює в каналі {channel}",
  "queue.hold.unnamed": "Очікування — цей агент працює в каналі {channel}",
  "queue.item.label": "Повідомлення в черзі {position}: {preview}",
  "queue.item.labelEditing": "Повідомлення в черзі {position}, редагується: {preview}",
  "queue.item.editing": "Редагується",
  "queue.item.steerLabel": "Скерувати повідомлення в черзі {position}",
  "queue.item.steerTooltip": "Скерувати повідомлення",
  "queue.item.steering": "Скерування",
  "queue.item.steer": "Скерувати",
  "queue.item.notSteered": "Не скеровано",
  "queue.item.steerFallback.providerUnsupported":
    "Цей провайдер не вміє скеровувати хід, що виконується, тому повідомлення чекає в черзі.",
  "queue.item.steerFallback.steerFailed": "Скерувати не вдалося, тому повідомлення чекає в черзі.",
  "queue.item.runAsTask": "Запустити в новій гілці",
  "queue.item.runAsTaskLabel": "Запустити повідомлення в черзі {position} у новій гілці",
  "queue.item.deleteLabel": "Видалити повідомлення в черзі {position}",
  "queue.item.deleteTooltip": "Видалити повідомлення",
  "queue.item.editLabel": "Змінити повідомлення в черзі {position}",
  "queue.item.editTooltip": "Змінити повідомлення",
  "queue.deleteHeld.title": "Видалити повідомлення з черги?",
  "queue.deleteHeld.body": "Це повідомлення редагується на іншому пристрої. Агент його не отримає.",
  "queue.deleteHeld.keep": "Залишити",
} as const satisfies PartialTranslation<typeof source>;
