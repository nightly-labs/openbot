import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token": "Slack 已不再接受该工作区中的 OpenBot，可能它被卸载了。请重新连接该工作区。",
  "messaging.help.secret_storage_unavailable": "OpenBot 无法在这台电脑上读取已保存的令牌。请断开该工作区后重新连接。",
  "messaging.help.relay_unavailable":
    "OpenBot 无法在这台电脑上接收 Slack 事件。请登录，在服务器设置中为这台电脑命名，并保持 OpenBot 开着。",
  // The same help for a Discord server connection.
  "messaging.discordHelp.invalid_token":
    "Discord 已不再接受该 Discord 服务器中的 OpenBot，可能已被移除。请重新连接该 Discord 服务器。",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot 无法在这台电脑上读取已保存的令牌。请断开该 Discord 服务器后重新连接。",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot 无法在这台电脑上接收 Discord 事件。请登录，在服务器设置中为这台电脑命名，并保持 OpenBot 开着。",
} as const satisfies PartialTranslation<typeof source>;
