import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Đăng nhập để chia sẻ",
  "mobile.share.signInDescription":
    "Quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể chọn trợ lý nhận nội dung đã chia sẻ.",
  "mobile.share.reading": "Đang đọc nội dung bạn chia sẻ…",
  "mobile.share.readFailed": "OpenBot không thể đọc nội dung bạn chia sẻ. Hãy chia sẻ lại.",
  "mobile.share.content": "Sẽ chia sẻ",
  "mobile.share.footer": "Trò chuyện mở với nội dung này trong ô tin nhắn. Không gửi đi cho tới khi bạn gửi.",
  "mobile.share.lastUsed": "Dùng gần nhất",
  "mobile.share.noAgents": "Không có trợ lý",
  "mobile.share.chooseAgent": "Chọn một trợ lý",
  "mobile.share.action": "Chia sẻ với {name}",
  "mobile.share.extension.send": "Gửi",
  "mobile.share.extension.footer": "OpenBot gửi nội dung này cho trợ lý ngay bây giờ. Ứng dụng không mở.",
  "mobile.share.extension.message": "Thêm một tin nhắn",
  "mobile.share.extension.sending": "Đang gửi tới {name}…",
  "mobile.share.extension.sent": "Đã gửi tới {name}",
  "mobile.share.extension.failed": "OpenBot không thể gửi nội dung này. Hãy mở ứng dụng để gửi từ đó.",
  "mobile.share.extension.unconfirmed":
    "Máy chủ không xác nhận tin nhắn. Hãy xem trong cuộc trò chuyện trước khi gửi lại.",
  "mobile.share.extension.openApp": "Mở OpenBot",
} as const satisfies PartialTranslation<typeof source>;
