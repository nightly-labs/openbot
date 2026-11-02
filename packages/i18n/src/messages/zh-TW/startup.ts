import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot 無法啟動",
  "startup.failedBody": "{message}\n\n你的本地資料沒有被重置或覆蓋。請檢視故障排查指南瞭解恢復步驟。",
} as const satisfies PartialTranslation<typeof source>;
