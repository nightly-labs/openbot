import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "テーブル",
  "sharedTable.description": "エージェントがタスクの間に保持するデータと、各レコードを作成したエージェント",
  "sharedTable.close": "テーブルを閉じる",
  "sharedTable.loading": "テーブルを読み込んでいます…",
  "sharedTable.empty":
    "まだテーブルはありません。タスクでターン間にレコードが必要になると、エージェントが自分で作成します。どのエージェントも使用できます。",
  "sharedTable.loadFailed": "テーブルを読み込めませんでした。",
  "sharedTable.deleteFailed": "削除できませんでした。",
  "sharedTable.madeOutside": "OpenBot の外部で作成 · どのエージェントでも削除できます",
  "sharedTable.keptBy": "{name} が保持",
  "sharedTable.keptByDeleted": "存在しないエージェントが保持",
  "sharedTable.deleteName": "{name} を削除",
  "sharedTable.confirmDelete": "すべてのエージェントから削除しますか？レコードは復元できません。",
  "sharedTable.notCounted": "未集計",
  "sharedTable.records": { other: "{count} 件のレコード" },
} as const satisfies PartialTranslation<typeof source>;
