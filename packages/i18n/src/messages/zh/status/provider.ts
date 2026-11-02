import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  // Provider runtime download status.
  "status.provider.downloadStopped": "下载已停止，请重试。",
  "status.provider.downloadFailed": "下载失败，请重试。",
  "status.provider.updateWaiting": "当前轮次结束后开始更新。",
  "status.provider.confirmContinue": "继续",
  "status.provider.confirmCancel": "取消",
} as const satisfies PartialTranslation<typeof source>;
