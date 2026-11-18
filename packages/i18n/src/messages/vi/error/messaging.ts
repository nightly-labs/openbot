import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Không gian làm việc Slack này chưa được kết nối.",
  "error.messaging.unsupported": "Máy tính này không thể kết nối với Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot không thể nhận sự kiện Slack trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này rồi thử lại.",
  "error.messaging.discordNotConnected": "Máy chủ Discord này chưa được kết nối.",
  "error.messaging.discordUnsupported": "Máy tính này không thể kết nối với Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot không thể nhận sự kiện Discord trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này rồi thử lại.",
  "error.messaging.discordRolesUnsupported": "OpenBot chưa thể liệt kê vai trò Discord. Hãy thử lại sau.",
  "error.messaging.telegramNotConnected": "Cuộc trò chuyện Telegram này chưa được kết nối.",
  "error.messaging.telegramUnsupported": "Máy tính này không thể kết nối với Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot không thể truy cập Telegram trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này rồi thử lại.",
  "error.messaging.telegramServiceUnavailable": "OpenBot hiện không thể kết nối Telegram. Hãy thử lại sau.",
  "error.messaging.whatsappNotConnected": "Số WhatsApp này chưa được kết nối.",
  "error.messaging.whatsappUnsupported": "Máy tính này không thể kết nối với WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Một số WhatsApp có thể cho phép tối đa 200 liên hệ và nhóm.",
  "error.messaging.whatsappNumberNotFound":
    "Số này không có tài khoản WhatsApp. Hãy nhập kèm mã quốc gia, ví dụ +44 7700 900123.",
  "error.messaging.whatsappRequestEnded": "Yêu cầu này đã kết thúc. Hãy nhờ người đó nhắn lại để nhận mã mới.",
  "error.messaging.memoryLimit":
    "Một không gian làm việc đã kết nối có thể có tối đa {limit} mục bộ nhớ. Hãy xóa bớt một mục trước.",
} as const satisfies PartialTranslation<typeof source>;
