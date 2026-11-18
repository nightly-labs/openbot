import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Đã đăng ký OpenBot này để truy cập qua WebRTC.",
  "status.host.keyRotated": "Khóa máy chủ đã thay đổi. Các thiết bị đã ghép nối vẫn được ghép nối.",
  "status.host.identityUpdated": "Đã cập nhật danh tính máy chủ.",
  "status.host.starting": "Đang khởi động host WebRTC…",
  "status.host.ready": "OpenBot này đã sẵn sàng cho kết nối WebRTC.",
  "status.host.signalLost": "Các thiết bị khác hiện không thể kết nối tới OpenBot này. OpenBot đang kết nối lại.",
  "status.host.stopping": "Đang chuyển OpenBot này sang chế độ riêng tư…",
  "status.host.private": "OpenBot này đang ở chế độ riêng tư.",
  "status.host.removed": "OpenBot này đã bị gỡ khỏi tài khoản của bạn. Hãy xuất bản lại để chia sẻ.",
} as const satisfies PartialTranslation<typeof source>;
