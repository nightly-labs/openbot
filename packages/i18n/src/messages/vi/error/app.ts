import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  // Errors from app, notification, and secret storage actions.
  "error.app.externalLinkProtocol": "Chỉ liên kết HTTP(S) mới mở được trong trình duyệt bên ngoài.",
  "error.app.notificationsUnsupported": "Hệ thống này không hỗ trợ thông báo trên máy tính để bàn.",
  "error.app.notificationSettingsMissing": "Hệ thống này không có trang cài đặt thông báo.",
  "error.app.notReady": "OpenBot chưa sẵn sàng.",
  "error.app.macSecureStorageUnavailable": "Kho lưu bảo mật của macOS không khả dụng.",
  "error.app.secretStorageUnavailable": "Kho lưu bí mật của hệ thống không khả dụng.",
  "error.app.remoteIdentityUnavailable": "Danh tính máy tính từ xa không khả dụng.",
  "error.app.iceServersMissing": "Remote Signal chưa cung cấp máy chủ ICE.",
  "error.app.finishLocalTest": "Hãy hoàn tất bài kiểm tra cục bộ trước khi chuyển hiển thị.",
} as const satisfies PartialTranslation<typeof source>;
