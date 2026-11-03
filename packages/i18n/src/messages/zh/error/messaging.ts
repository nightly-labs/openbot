import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "该 Slack 工作区未连接。",
  "error.messaging.unsupported": "这台电脑无法连接 Slack。",
  "error.messaging.relayUnavailable": "OpenBot 无法在这台电脑上接收 Slack 事件。请登录，为这台电脑命名后重试。",
  // Errors of a Discord server connection, which the host sends.
  "error.messaging.discordNotConnected": "该 Discord 服务器未连接。",
  "error.messaging.discordUnsupported": "这台电脑无法连接 Discord。",
  "error.messaging.discordRelayUnavailable":
    "OpenBot 无法在这台电脑上接收 Discord 事件。请登录，为这台电脑命名后重试。",
  "error.messaging.discordRolesUnsupported": "OpenBot 暂时无法列出 Discord 角色，请稍后重试。",
  // Errors of a Telegram chat connection, which the host sends.
  "error.messaging.telegramNotConnected": "该 Telegram 聊天未连接。",
  "error.messaging.telegramUnsupported": "这台电脑无法连接 Telegram。",
  "error.messaging.telegramRelayUnavailable": "OpenBot 无法在这台电脑上连接 Telegram。请登录，为这台电脑命名后重试。",
  "error.messaging.telegramServiceUnavailable": "OpenBot 当前无法连接 Telegram，请稍后重试。",
  // Errors of a linked WhatsApp number, which the host sends.
  "error.messaging.whatsappNotConnected": "该 WhatsApp 号码未连接。",
  "error.messaging.whatsappUnsupported": "这台电脑无法连接 WhatsApp。",
  "error.messaging.whatsappTooManySenders": "一个 WhatsApp 号码最多可允许 200 个联系人和群组。",
  "error.messaging.whatsappRequestEnded": "该请求已结束。请让对方重新发消息以获取新代码。",
  // The agent gets this when a connected workspace has too many saved facts.
  "error.messaging.memoryLimit": "一个已连接的工作区最多可有 {limit} 条记忆，请先删除一条。",
} as const satisfies PartialTranslation<typeof source>;
