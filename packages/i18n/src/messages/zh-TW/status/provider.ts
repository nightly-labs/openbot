import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  // Provider runtime download status.
  "status.provider.downloadStopped": "下載已停止，請重試。",
  "status.provider.downloadFailed": "下載失敗，請重試。",
  "status.provider.updateWaiting": "當前輪次結束後開始更新。",
  "status.provider.confirmContinue": "繼續",
  "status.provider.confirmCancel": "取消",
} as const satisfies PartialTranslation<typeof source>;
