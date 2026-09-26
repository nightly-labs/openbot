import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "メモリー",
  "memory.description": "{name} の保存済みメモリー",
  "memory.add": "メモリーを追加",
  "memory.close": "メモリーを閉じる",
  "memory.new": "新しいメモリー",
  "memory.newPlaceholder": "長く覚えておく事実や好みを追加",
  "memory.save": "メモリーを保存",
  "memory.limitAgent":
    "このエージェントはメモリーの上限（{limit} 件）に達しました。別のメモリーを追加する前に、メモリーを編集、統合、または削除してください。",
  "memory.limitChannel":
    "このチャンネルはメモリーの上限（{limit} 件）に達しました。別のメモリーを追加する前に、メモリーを編集、統合、または削除してください。",
  "memory.loading": "メモリーを読み込んでいます…",
  "memory.emptyAgent": "このエージェントにはまだ保存済みのメモリーがありません。",
  "memory.emptyChannel": "このチャンネルにはまだ保存済みのメモリーがありません。",
  "memory.editText": "メモリーを編集: {text}",
  "memory.edit": "メモリーを編集",
  "memory.delete": "メモリーを削除",
  "memory.learned": "自動で学習",
  "memory.manual": "手動で追加",
  "memory.unknownDate": "日付不明",
  "memory.clearAll": "すべてのメモリーを消去",
  "memory.clearTitle": "すべてのメモリーを消去しますか？",
  "memory.clearDescription":
    "OpenBot は {name} の保存済みメモリー {total} 件をすべて完全に削除します。元のメッセージは会話履歴に残ります。",

  "memory.loadFailed": "メモリーを読み込めませんでした。",
  "memory.saveFailed": "メモリーを保存できませんでした。",
  "memory.updateFailed": "メモリーを更新できませんでした。",
  "memory.deleteFailed": "メモリーを削除できませんでした。",
  "memory.clearFailed": "メモリーを消去できませんでした。",
} as const satisfies PartialTranslation<typeof source>;
