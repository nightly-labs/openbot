import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "メッセージキュー",
  "queue.moved": "キューのメッセージを {total} 件中 {position} 番目に移動しました。",
  "queue.attachment": "添付ファイル",
  "queue.hold.named": "待機中 - {name} は {channel} で作業しています",
  "queue.hold.unnamed": "待機中 - このエージェントは {channel} で作業しています",
  "queue.item.label": "キューのメッセージ {position}: {preview}",
  "queue.item.labelEditing": "キューのメッセージ {position}、編集中: {preview}",
  "queue.item.editing": "編集中",
  "queue.item.steerLabel": "キューのメッセージ {position} で方向を修正",
  "queue.item.steerTooltip": "メッセージで方向を修正",
  "queue.item.steering": "修正中",
  "queue.item.steer": "方向を修正",
  "queue.item.deleteLabel": "キューのメッセージ {position} を削除",
  "queue.item.deleteTooltip": "メッセージを削除",
  "queue.item.editLabel": "キューのメッセージ {position} を編集",
  "queue.item.editTooltip": "メッセージを編集",
  "queue.deleteHeld.title": "キューのメッセージを削除しますか？",
  "queue.deleteHeld.body":
    "別のデバイスがこのメッセージを編集しています。エージェントはこのメッセージを受け取りません。",
  "queue.deleteHeld.keep": "残す",
} as const satisfies PartialTranslation<typeof source>;
