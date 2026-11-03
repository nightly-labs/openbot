import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  // Provider runtime download status.
  "status.provider.downloadStopped": "下载已停止，请重试。",
  "status.provider.downloadFailed": "下载失败，请重试。",
  "status.provider.updateWaiting": "当前轮次结束后开始更新。",
  "status.provider.confirmContinue": "继续",
  "status.provider.confirmCancel": "取消",
  "status.provider.retryUnreachable": "{provider} 无法连接到其服务器。第 {attempt}/{maxAttempts} 次重试。",
  "status.provider.retryServerError": "{provider} 服务器繁忙或出错。第 {attempt}/{maxAttempts} 次重试。",
  "status.provider.retryRecovered": "{provider} 已重新从其服务器收到响应。",
} as const satisfies PartialTranslation<typeof source>;
