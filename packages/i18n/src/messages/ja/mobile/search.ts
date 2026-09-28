import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "検索をクリア",
  "mobile.search.emptyTitle": "一致する結果はありません",
  "mobile.search.emptyBody": "別の検索語をお試しください。",
  "mobile.search.searching": "メッセージを検索中…",
  "mobile.search.errorTitle": "メッセージを検索できませんでした",
  "mobile.search.errorBody": "このコンピューターへの接続を確認して、もう一度お試しください。",
  "mobile.search.retry": "もう一度試す",
  "mobile.search.showMore": "さらにメッセージを表示",
  "mobile.search.fromYou": "あなた → {name} · {time}",
  "mobile.search.toYou": "{name} → あなた · {time}",
} as const satisfies PartialTranslation<typeof source>;
