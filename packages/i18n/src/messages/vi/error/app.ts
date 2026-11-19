import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Chỉ liên kết HTTP(S) mới mở được trong trình duyệt bên ngoài.",
  "error.app.notificationsUnsupported": "Hệ thống này không hỗ trợ thông báo trên màn hình.",
  "error.app.notificationSettingsMissing": "Hệ thống này không có trang cài đặt thông báo.",
  "error.app.notReady": "OpenBot chưa sẵn sàng.",
  "error.app.macSecureStorageUnavailable": "Không dùng được bộ lưu trữ bảo mật của macOS.",
  "error.app.secretStorageUnavailable": "Không dùng được bộ lưu trữ bí mật của hệ thống.",
  "error.app.remoteIdentityUnavailable": "Không có danh tính của host từ xa.",
  "error.app.iceServersMissing": "Remote Signal chưa cung cấp máy chủ ICE.",
  "error.app.finishLocalTest": "Hãy hoàn tất bài kiểm tra cục bộ trước khi chuyển màn hình.",
} as const satisfies PartialTranslation<typeof source>;
