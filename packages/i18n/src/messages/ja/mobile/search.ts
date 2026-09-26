import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.filter.all": "すべて",
  "mobile.search.filter.messages": "メッセージ",
  "mobile.search.filter.agents": "エージェント",
  "mobile.search.filter.files": "ファイル",
  "mobile.search.filter.routines": "ルーティン",
  "mobile.search.filterResults": "結果を絞り込み、{filter}",
  "mobile.search.clear": "検索をクリア",
  "mobile.search.emptyTitle": "一致する結果はありません",
  "mobile.search.emptyBody": "別の検索語を試すか、別のフィルターを選択してください。",
} as const satisfies PartialTranslation<typeof source>;
