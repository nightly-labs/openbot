import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Đăng nhập để chia sẻ",
  "mobile.share.signInDescription":
    "Quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể chọn agent nhận nội dung bạn chia sẻ.",
  "mobile.share.reading": "Đang đọc nội dung bạn chia sẻ…",
  "mobile.share.readFailed": "OpenBot không thể đọc nội dung bạn chia sẻ. Hãy chia sẻ lại.",
  "mobile.share.content": "Nội dung chia sẻ",
  "mobile.share.footer":
    "Cuộc trò chuyện sẽ mở với nội dung này trong ô tin nhắn. Không có gì được gửi cho đến khi bạn gửi.",
  "mobile.share.sendFooter": "OpenBot gửi nội dung này cho agent, rồi mở cuộc trò chuyện.",
  "mobile.share.lastUsed": "Dùng gần đây",
  "mobile.share.noAgents": "Không có agent",
  "mobile.share.chooseAgent": "Chọn một agent",
  "mobile.share.action": "Chia sẻ với {name}",
  "mobile.share.extension.send": "Gửi",
  "mobile.share.extension.footer": "OpenBot gửi nội dung này cho agent ngay. Ứng dụng sẽ không mở.",
  "mobile.share.extension.message": "Thêm tin nhắn",
  "mobile.share.extension.sending": "Đang gửi đến {name}…",
  "mobile.share.extension.sent": "Đã gửi đến {name}",
  "mobile.share.extension.failed": "OpenBot không thể gửi nội dung này. Hãy mở ứng dụng để gửi từ đó.",
  "mobile.share.extension.unconfirmed":
    "Máy chủ chưa xác nhận tin nhắn. Hãy kiểm tra cuộc trò chuyện trước khi gửi lại.",
  "mobile.share.extension.openApp": "Mở OpenBot",
} as const satisfies PartialTranslation<typeof source>;
