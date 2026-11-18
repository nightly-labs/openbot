import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Chưa kết nối",
  "mobile.workspace.status.online": "Trực tuyến",
  "mobile.workspace.status.offline": "Ngoại tuyến",
  "mobile.workspace.status.error": "Lỗi kết nối",
  "mobile.workspace.status.reconnecting": "Đang kết nối lại",
  "mobile.workspace.status.attempt": "Lần thử {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Lần thử ",
  "mobile.workspace.status.retryIn": "Thử lại sau {seconds} giây",
  "mobile.workspace.section.agents": "Agent",
  "mobile.workspace.error.directoryUnavailable": "Thư mục máy chủ không khả dụng.",
  "mobile.workspace.error.sectionsLoadFailed": "Không thể tải các thư mục. Hãy thử lại.",
  "mobile.workspace.error.transportNotReady": "Kênh truyền trên di động chưa sẵn sàng.",
  "mobile.workspace.error.sectionsUnsupported": "Host này không hỗ trợ thay đổi thư mục.",
  "mobile.workspace.error.leaveOwnServer": "Chỉ có thể rời các máy chủ từ xa mà bạn đã tham gia.",
  "mobile.workspace.error.removeOwnedServerOnly": "Chỉ chủ sở hữu mới có thể gỡ máy chủ này.",
  "mobile.workspace.error.agentNotOnHost": "Agent không có trên host này.",
  "mobile.workspace.error.filesUnsupported": "Host này không hỗ trợ quản lý tệp. Hãy cập nhật OpenBot trên host.",
  "mobile.workspace.error.agentUnavailableOnHost": "Agent không khả dụng trên host này.",
  "mobile.workspace.error.agentUnavailable": "Agent không khả dụng.",
  "mobile.workspace.error.formUnavailable": "Biểu mẫu này không còn khả dụng.",
  "mobile.workspace.error.approvalInactive":
    "Yêu cầu này hiện không còn chờ. Một thiết bị khác đã trả lời, hoặc tác vụ đã dừng.",
  "mobile.workspace.error.approvalOffline": "Hãy kết nối với máy chủ để trả lời yêu cầu này.",
  "mobile.workspace.alert.preferencesTitle": "Không thể lưu tùy chọn trò chuyện",
  "mobile.workspace.alert.preferencesBody": "Tùy chọn trước đó của bạn vẫn được giữ nguyên. Hãy thử lại.",
  "mobile.workspace.alert.updateRequiredTitle": "Cần cập nhật",
  "mobile.workspace.alert.updateRequiredUnread":
    "Hãy cập nhật máy chủ trên máy tính này để đánh dấu cuộc trò chuyện là chưa đọc.",
  "mobile.workspace.alert.markUnreadTitle": "Không thể đánh dấu chưa đọc",
  "mobile.workspace.alert.markUnreadBody": "Hãy kết nối lại với máy chủ rồi thử lại.",
  "mobile.workspace.alert.markAllReadTitle": "Không thể đánh dấu tất cả là đã đọc",
  "mobile.workspace.alert.markAllReadBody":
    "Một số cuộc trò chuyện vẫn chưa đọc. Hãy kết nối lại với máy chủ rồi thử lại.",
  "mobile.workspace.alert.serverOrderTitle": "Không thể lưu thứ tự máy chủ",
  "mobile.workspace.alert.serverOrderBody": "Thứ tự trước đó của bạn vẫn được giữ nguyên. Hãy thử lại.",
  "mobile.workspace.error.connectFailed": "Kết nối với máy chủ thất bại.",
  "mobile.workspace.error.disconnectFailed": "Máy chủ không ngắt kết nối đúng cách.",
  "mobile.workspace.error.queueEditRejected": "Host không chấp nhận chỉnh sửa này.",
} as const satisfies PartialTranslation<typeof source>;
