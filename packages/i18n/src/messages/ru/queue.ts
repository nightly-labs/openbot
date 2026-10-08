import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Очередь сообщений",
  "queue.moved": "Сообщение из очереди перемещено на позицию {position} из {total}.",
  "queue.attachment": "Вложение",
  "queue.hold.named": "Ожидание — {name} работает в канале {channel}",
  "queue.hold.unnamed": "Ожидание — этот агент работает в канале {channel}",
  "queue.item.label": "Сообщение в очереди {position}: {preview}",
  "queue.item.labelEditing": "Сообщение в очереди {position}, редактируется: {preview}",
  "queue.item.editing": "Редактируется",
  "queue.item.steerLabel": "Направить сообщение в очереди {position}",
  "queue.item.steerTooltip": "Направить сообщение",
  "queue.item.steering": "Направляется",
  "queue.item.steer": "Направить",
  "queue.item.notSteered": "Не направлено",
  "queue.item.steerFallback.providerUnsupported":
    "Этот провайдер не умеет направлять выполняемый ход, поэтому сообщение ждёт в очереди.",
  "queue.item.steerFallback.steerFailed": "Направить не удалось, поэтому сообщение ждёт в очереди.",
  "queue.item.deleteLabel": "Удалить сообщение в очереди {position}",
  "queue.item.deleteTooltip": "Удалить сообщение",
  "queue.item.editLabel": "Изменить сообщение в очереди {position}",
  "queue.item.editTooltip": "Изменить сообщение",
  "queue.deleteHeld.title": "Удалить сообщение из очереди?",
  "queue.deleteHeld.body": "Это сообщение редактируется на другом устройстве. Агент его не получит.",
  "queue.deleteHeld.keep": "Оставить",
} as const satisfies PartialTranslation<typeof source>;
