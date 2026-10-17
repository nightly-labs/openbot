import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "数据表",
  "sharedTable.description": "助手在任务之间保留的数据，以及发起每组记录的助手",
  "sharedTable.close": "关闭数据表",
  "sharedTable.loading": "正在加载数据表…",
  "sharedTable.empty": "还没有数据表。当任务需要跨轮次保留记录时，助手会自己创建一张，之后所有助手都可以使用。",
  "sharedTable.loadFailed": "无法加载数据表。",
  "sharedTable.deleteFailed": "无法删除该项。",
  "sharedTable.madeOutside": "在 OpenBot 之外创建 · 任何助手都可以删除",
  "sharedTable.keptBy": "由 {name} 维护",
  "sharedTable.keptByDeleted": "由已不存在的助手维护",
  "sharedTable.deleteName": "删除 {name}",
  "sharedTable.confirmDelete": "对所有助手删除该项？记录将无法恢复。",
  "sharedTable.notCounted": "未计入",
  "sharedTable.records": { one: "{count} 条记录", other: "{count} 条记录" },
} as const satisfies PartialTranslation<typeof source>;
