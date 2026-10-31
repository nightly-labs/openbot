import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "資料表",
  "sharedTable.description": "助理在任務之間保留的資料，以及發起每組記錄的助理",
  "sharedTable.close": "關閉資料表",
  "sharedTable.loading": "正在載入資料表…",
  "sharedTable.empty": "還沒有資料表。當任務需要跨輪次保留記錄時，助理會自己建立一張，之後所有助理都可以使用。",
  "sharedTable.loadFailed": "無法載入資料表。",
  "sharedTable.deleteFailed": "無法刪除該項。",
  "sharedTable.madeOutside": "在 OpenBot 之外建立 · 任何助理都可以刪除",
  "sharedTable.keptBy": "由 {name} 維護",
  "sharedTable.keptByDeleted": "由已不存在的助理維護",
  "sharedTable.deleteName": "刪除 {name}",
  "sharedTable.confirmDelete": "對所有助理刪除該項？記錄將無法恢復。",
  "sharedTable.notCounted": "未計入",
  "sharedTable.records": { one: "{count} 條記錄", other: "{count} 條記錄" },
} as const satisfies PartialTranslation<typeof source>;
