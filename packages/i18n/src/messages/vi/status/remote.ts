import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "Thiết lập quyền chỉ khả dụng trên macOS.",
  "status.remote.setupInstallHost": "Cài thành phần máy chủ của desktop từ xa, rồi kiểm tra lại.",
  "status.remote.setupUpdateRuntime": "Cập nhật runtime của desktop từ xa để kiểm tra quyền macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine không thể hoàn tất kiểm tra quyền. Hãy kiểm tra phiên của máy chủ, rồi thử lại.",
  "status.remote.setupServiceFailed":
    "Dịch vụ desktop từ xa không thể khởi động. Hãy kiểm tra xem người dùng macOS này có phiên GUI đang hoạt động không.",
  "status.remote.connectingSunshine": "Đang kết nối qua Sunshine…",
  "status.remote.switchingMonitor": "Đang chuyển màn hình chia sẻ…",
  "status.remote.controlConnected": "Đã kết nối điều khiển từ xa.",
  "status.remote.controlFailed": "Điều khiển từ xa thất bại.",
  "status.remote.stagePreferences": "Đang tải tùy chọn trò chuyện cục bộ: {reason}",
  "status.remote.stageConnection": "Đang kết nối tới desktop: {reason}",
  "status.remote.stageCompatibility": "Đang kiểm tra khả năng tương thích của desktop: {reason}",
  "status.remote.stageAgents": "Đang tải các trợ lý: {reason}",
  "status.remote.stageReads": "Đang tải trạng thái đã đọc: {reason}",
  "status.remote.suspendedDetail": "Hãy cập nhật OpenBot Mobile hoặc ứng dụng desktop trước khi kết nối.\n{detail}",
  "status.remote.cooldownDetail": "Kết nối thất bại sau {limit} lần thử. Thử lại sau {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Kết nối thất bại sau {limit} lần thử. Thử lại sau {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    other: "Mất kết nối. Thử lại sau {count} giây.\n{detail}",
  },
  "status.remote.connectionLost": {
    other: "Mất kết nối. Thử lại sau {count} giây.",
  },
  "status.remote.attemptFailedDetail": {
    other: "Lần kết nối thất bại. Thử lại sau {count} giây.\n{detail}",
  },
  "status.remote.attemptFailed": {
    other: "Lần kết nối thất bại. Thử lại sau {count} giây.",
  },
  "status.remote.reconnectingDetail": {
    other: "Đang kết nối lại {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { other: "Đang kết nối lại {attempt}/{count}" },
  // The host writes this in the middle of a message that is too large to send to a remote client.
  "status.remote.messageCut":
    "[{size} MB của tin nhắn này không hiển thị trên thiết bị này. Hãy mở nó trên máy tính chạy máy chủ để đọc toàn bộ.]",
} as const satisfies PartialTranslation<typeof source>;
