import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack không còn chấp nhận OpenBot trong không gian làm việc này. Có thể ứng dụng đã bị gỡ cài đặt. Hãy kết nối lại không gian làm việc.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot không đọc được các token đã lưu trên máy tính này. Hãy ngắt kết nối không gian làm việc, rồi kết nối lại.",
  "messaging.help.relay_unavailable":
    "OpenBot không nhận được sự kiện Slack trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này trong Cài đặt máy chủ và giữ OpenBot mở.",
  "messaging.help.not_linked":
    "Không gian làm việc này chưa được liên kết với máy chủ này. Chọn Kết nối lại để liên kết.",
  "messaging.discordHelp.invalid_token":
    "Discord không còn chấp nhận OpenBot trong máy chủ Discord này. Có thể ứng dụng đã bị gỡ. Hãy kết nối lại máy chủ Discord.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot không đọc được các token đã lưu trên máy tính này. Hãy ngắt kết nối máy chủ Discord, rồi kết nối lại.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot không nhận được sự kiện Discord trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này trong Cài đặt máy chủ và giữ OpenBot mở.",
  "messaging.discordHelp.not_linked":
    "Máy chủ Discord này chưa được liên kết với máy chủ OpenBot này. Chọn Kết nối lại để liên kết.",
} as const satisfies PartialTranslation<typeof source>;
