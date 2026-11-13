import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack không còn chấp nhận OpenBot trong không gian làm việc này. Có thể ứng dụng đã bị gỡ cài đặt. Hãy kết nối lại không gian làm việc.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot không thể đọc các token đã lưu trên máy tính này. Hãy ngắt kết nối không gian làm việc rồi kết nối lại.",
  "messaging.help.relay_unavailable":
    "OpenBot không thể nhận sự kiện Slack trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này trong Cài đặt máy chủ, và giữ OpenBot mở.",
  // The same help for a Discord server connection.
  "messaging.discordHelp.invalid_token":
    "Discord không còn chấp nhận OpenBot trong máy chủ Discord này. Có thể nó đã bị gỡ bỏ. Hãy kết nối lại máy chủ Discord.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot không thể đọc các token đã lưu trên máy tính này. Hãy ngắt kết nối máy chủ Discord rồi kết nối lại.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot không thể nhận sự kiện Discord trên máy tính này. Hãy đăng nhập, đặt tên cho máy tính này trong Cài đặt máy chủ, và giữ OpenBot mở.",
} as const satisfies PartialTranslation<typeof source>;
