import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "訊息佇列",
  "queue.moved": "已將排隊訊息移動到第 {position} 位，共 {total} 條。",
  "queue.attachment": "附件",
  "queue.hold.named": "等待中 - {name} 正在 {channel} 中工作",
  "queue.hold.unnamed": "等待中 - 該助理正在 {channel} 中工作",
  "queue.item.label": "排隊訊息 {position}：{preview}",
  "queue.item.labelEditing": "排隊訊息 {position}，編輯中：{preview}",
  "queue.item.editing": "編輯中",
  "queue.item.steerLabel": "引導排隊訊息 {position}",
  "queue.item.steerTooltip": "引導訊息",
  "queue.item.steering": "引導中",
  "queue.item.steer": "引導",
  "queue.item.notSteered": "未引導",
  "queue.item.steerFallback.providerUnsupported": "該供應商無法在執行中引導，訊息會留在佇列中等待。",
  "queue.item.steerFallback.steerFailed": "引導未成功，訊息會留在佇列中等待。",
  "queue.item.runAsTask": "在新話題中執行",
  "queue.item.runAsTaskLabel": "在新話題中執行排隊訊息 {position}",
  "queue.item.deleteLabel": "刪除排隊訊息 {position}",
  "queue.item.deleteTooltip": "刪除訊息",
  "queue.item.editLabel": "編輯排隊訊息 {position}",
  "queue.item.editTooltip": "編輯訊息",
  "queue.deleteHeld.title": "刪除排隊訊息？",
  "queue.deleteHeld.body": "另一臺裝置正在編輯這條訊息，助理將不會收到它。",
  "queue.deleteHeld.keep": "保留",
} as const satisfies PartialTranslation<typeof source>;
