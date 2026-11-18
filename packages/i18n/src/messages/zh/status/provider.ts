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
  "status.provider.modelRetryUnreachable": "{provider} 无法连接到模型提供商。正在重试：第 {attempt} 次。",
  "status.provider.modelRetryServerError": "模型提供商繁忙或出错。{provider} 正在重试：第 {attempt} 次。",
  "status.provider.modelRetryOutOfMemory":
    "模型服务器的内存不足以处理此聊天。{provider} 正在重试：第 {attempt} 次。新的聊天需要的内存更少。",
  "status.provider.modelRetryRecovered": "模型提供商已恢复响应。",
  "status.provider.retryRecovered": "{provider} 已重新从其服务器收到响应。",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude 以标准速度回答。使用 Claude 订阅时，快速模式使用用量额度。请在你的 Claude 账户中开启。",
  "status.provider.claudeFastModeNotOnPlan": "Claude 以标准速度回答。你的 Claude 套餐不包含快速模式。",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude 以标准速度回答。快速模式仅适用于 Anthropic API 密钥或 Claude 订阅，不适用于 Bedrock、Vertex、Foundry 或网关。",
  "status.provider.claudeFastModeModelNotAllowed": "Claude 以标准速度回答。此模型无法在你的账户中使用快速模式。",
  "status.provider.claudeFastModeTurnedOff": "Claude 以标准速度回答。快速模式已在 Claude Code 设置中或由你的组织关闭。",
  "status.provider.claudeFastModeUnavailable": "Claude 以标准速度回答。Claude Code 无法在本轮使用快速模式。",
  "status.provider.claudeOwnApiKey":
    "Claude Code 已设置为使用 Anthropic API 密钥。Anthropic 会从该密钥的 API 额度中扣除每次请求的费用，而不是从你的 Claude 套餐中扣除。要使用你的套餐，请从 Claude Code 设置或环境变量中移除该密钥，然后重启 OpenBot。",
} as const satisfies PartialTranslation<typeof source>;
