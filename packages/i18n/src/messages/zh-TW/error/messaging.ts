import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "該 Slack 工作區未連線。",
  "error.messaging.unsupported": "這臺電腦無法連線 Slack。",
  "error.messaging.relayUnavailable": "OpenBot 無法在這臺電腦上接收 Slack 事件。請登入，為這臺電腦命名後重試。",
  // Errors of a Discord server connection, which the host sends.
  "error.messaging.discordNotConnected": "該 Discord 伺服器未連線。",
  "error.messaging.discordUnsupported": "這臺電腦無法連線 Discord。",
  "error.messaging.discordRelayUnavailable":
    "OpenBot 無法在這臺電腦上接收 Discord 事件。請登入，為這臺電腦命名後重試。",
  "error.messaging.discordRolesUnsupported": "OpenBot 暫時無法列出 Discord 角色，請稍後重試。",
  // Errors of a Telegram chat connection, which the host sends.
  "error.messaging.telegramNotConnected": "該 Telegram 聊天未連線。",
  "error.messaging.telegramUnsupported": "這臺電腦無法連線 Telegram。",
  "error.messaging.telegramRelayUnavailable": "OpenBot 無法在這臺電腦上連線 Telegram。請登入，為這臺電腦命名後重試。",
  "error.messaging.telegramServiceUnavailable": "OpenBot 當前無法連線 Telegram，請稍後重試。",
  // The agent gets this when a connected workspace has too many saved facts.
  "error.messaging.memoryLimit": "一個已連線的工作區最多可有 {limit} 條記憶，請先刪除一條。",
} as const satisfies PartialTranslation<typeof source>;
