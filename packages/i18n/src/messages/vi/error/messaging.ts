import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "Không gian làm việc Slack này chưa được kết nối.",
  "error.messaging.unsupported": "Máy tính này không thể kết nối Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot không thể nhận sự kiện Slack trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này và thử lại.",
  // Errors of a Discord server connection, which the host sends.
  "error.messaging.discordNotConnected": "Máy chủ Discord này chưa được kết nối.",
  "error.messaging.discordUnsupported": "Máy tính này không thể kết nối Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot không thể nhận sự kiện Discord trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này và thử lại.",
  "error.messaging.discordRolesUnsupported": "OpenBot chưa thể liệt kê vai trò Discord. Hãy thử lại sau.",
  // Errors of a Telegram chat connection, which the host sends.
  "error.messaging.telegramNotConnected": "Cuộc trò chuyện Telegram này chưa được kết nối.",
  "error.messaging.telegramUnsupported": "Máy tính này không thể kết nối Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot không thể kết nối Telegram trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này và thử lại.",
  "error.messaging.telegramServiceUnavailable": "OpenBot không thể kết nối Telegram bây giờ. Hãy thử lại sau.",
  // Errors of a linked WhatsApp number, which the host sends.
  "error.messaging.whatsappNotConnected": "Số WhatsApp này chưa được kết nối.",
  "error.messaging.whatsappUnsupported": "Máy tính này không thể kết nối WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Một số WhatsApp có thể cho phép tối đa 200 liên hệ và nhóm.",
  "error.messaging.whatsappRequestEnded": "Yêu cầu này đã kết thúc. Hãy nhờ người đó nhắn lại để nhận mã mới.",
  // The agent gets this when a connected workspace has too many saved facts.
  "error.messaging.memoryLimit":
    "Một không gian làm việc được kết nối có thể có tối đa {limit} trí nhớ. Hãy xóa một trí nhớ trước.",
} as const satisfies PartialTranslation<typeof source>;
