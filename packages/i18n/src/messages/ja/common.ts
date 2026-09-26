import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "キャンセル",
  "common.save": "保存",
  "common.close": "閉じる",
  "common.delete": "削除",
  "common.remove": "取り除く",
  "common.edit": "編集",
  "common.rename": "名前を変更",
  "common.retry": "再試行",
  "common.copy": "コピー",
  "common.copied": "コピーしました",
  "common.done": "完了",
  "common.back": "戻る",
  "common.continue": "続行",
  "common.add": "追加",
  "common.create": "作成",
  "common.open": "開く",
  "common.search": "検索",
  "common.loading": "読み込み中…",
  "common.saving": "保存しています…",
  "common.tryAgain": "もう一度試す",
  "common.connecting": "接続しています…",
  "common.download": "ダウンロード",
  "common.removing": "削除しています…",
  "common.sending": "送信しています…",
} as const satisfies PartialTranslation<typeof source>;
