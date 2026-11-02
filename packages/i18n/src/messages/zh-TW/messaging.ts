import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token": "Slack 已不再接受該工作區中的 OpenBot，可能它被解除安裝了。請重新連線該工作區。",
  "messaging.help.secret_storage_unavailable": "OpenBot 無法在這臺電腦上讀取已儲存的權杖。請斷開該工作區後重新連線。",
  "messaging.help.relay_unavailable":
    "OpenBot 無法在這臺電腦上接收 Slack 事件。請登入，在伺服器設定中為這臺電腦命名，並保持 OpenBot 開著。",
  // The same help for a Discord server connection.
  "messaging.discordHelp.invalid_token":
    "Discord 已不再接受該 Discord 伺服器中的 OpenBot，可能已被移除。請重新連線該 Discord 伺服器。",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot 無法在這臺電腦上讀取已儲存的權杖。請斷開該 Discord 伺服器後重新連線。",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot 無法在這臺電腦上接收 Discord 事件。請登入，在伺服器設定中為這臺電腦命名，並保持 OpenBot 開著。",
} as const satisfies PartialTranslation<typeof source>;
