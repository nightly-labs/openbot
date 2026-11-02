import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "消息队列",
  "queue.moved": "已将排队消息移动到第 {position} 位，共 {total} 条。",
  "queue.attachment": "附件",
  "queue.hold.named": "等待中 - {name} 正在 {channel} 中工作",
  "queue.hold.unnamed": "等待中 - 该助手正在 {channel} 中工作",
  "queue.item.label": "排队消息 {position}：{preview}",
  "queue.item.labelEditing": "排队消息 {position}，编辑中：{preview}",
  "queue.item.editing": "编辑中",
  "queue.item.steerLabel": "引导排队消息 {position}",
  "queue.item.steerTooltip": "引导消息",
  "queue.item.steering": "引导中",
  "queue.item.steer": "引导",
  "queue.item.notSteered": "未引导",
  "queue.item.steerFallback.providerUnsupported": "该服务商无法在运行中引导，消息会留在队列中等待。",
  "queue.item.steerFallback.steerFailed": "引导未成功，消息会留在队列中等待。",
  "queue.item.runAsTask": "在新话题中运行",
  "queue.item.runAsTaskLabel": "在新话题中运行排队消息 {position}",
  "queue.item.deleteLabel": "删除排队消息 {position}",
  "queue.item.deleteTooltip": "删除消息",
  "queue.item.editLabel": "编辑排队消息 {position}",
  "queue.item.editTooltip": "编辑消息",
  "queue.deleteHeld.title": "删除排队消息？",
  "queue.deleteHeld.body": "另一台设备正在编辑这条消息，助手将不会收到它。",
  "queue.deleteHeld.keep": "保留",
} as const satisfies PartialTranslation<typeof source>;
