import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "Đã đăng ký OpenBot này cho truy cập WebRTC.",
  "status.host.keyRotated": "Khóa máy chủ đã thay đổi. Các thiết bị đã ghép nối vẫn giữ nguyên ghép nối.",
  "status.host.identityUpdated": "Đã cập nhật danh tính máy chủ.",
  "status.host.starting": "Đang khởi động máy chủ WebRTC…",
  "status.host.ready": "OpenBot này đã sẵn sàng cho các kết nối WebRTC.",
  "status.host.signalLost": "Hiện các thiết bị khác không thể kết nối tới OpenBot này. Nó sẽ kết nối lại.",
  "status.host.stopping": "Đang chuyển OpenBot này sang chế độ riêng tư…",
  "status.host.private": "OpenBot này đang ở chế độ riêng tư.",
  "status.host.removed": "OpenBot này đã bị gỡ khỏi tài khoản của bạn. Hãy công bố lại để chia sẻ.",
} as const satisfies PartialTranslation<typeof source>;
