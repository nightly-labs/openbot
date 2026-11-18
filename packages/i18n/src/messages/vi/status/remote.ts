import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Chỉ có thể thiết lập quyền trên macOS.",
  "status.remote.setupInstallHost": "Hãy cài thành phần host cho máy tính từ xa, rồi kiểm tra lại.",
  "status.remote.setupUpdateRuntime": "Hãy cập nhật runtime máy tính từ xa để kiểm tra quyền trên macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine không thể hoàn tất kiểm tra quyền. Hãy kiểm tra phiên trên host, rồi thử lại.",
  "status.remote.setupServiceFailed":
    "Không thể khởi động dịch vụ máy tính từ xa. Hãy kiểm tra người dùng macOS này có phiên giao diện đồ họa đang hoạt động.",
  "status.remote.connectingSunshine": "Đang kết nối qua Sunshine…",
  "status.remote.switchingMonitor": "Đang chuyển màn hình chia sẻ…",
  "status.remote.controlConnected": "Đã kết nối điều khiển từ xa.",
  "status.remote.controlFailed": "Điều khiển từ xa thất bại.",
  "status.remote.stagePreferences": "Đang tải tùy chọn trò chuyện cục bộ: {reason}",
  "status.remote.stageConnection": "Đang kết nối tới máy tính: {reason}",
  "status.remote.stageCompatibility": "Đang kiểm tra khả năng tương thích của máy tính: {reason}",
  "status.remote.stageAgents": "Đang tải agent: {reason}",
  "status.remote.stageReads": "Đang tải trạng thái đã đọc: {reason}",
  "status.remote.suspendedDetail": "Hãy cập nhật OpenBot Mobile hoặc ứng dụng máy tính trước khi kết nối.\n{detail}",
  "status.remote.cooldownDetail": "Kết nối thất bại sau {limit} lần thử. Thử lại sau {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Kết nối thất bại sau {limit} lần thử. Thử lại sau {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Mất kết nối. Thử lại sau {count} giây.\n{detail}",
    other: "Mất kết nối. Thử lại sau {count} giây.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Mất kết nối. Thử lại sau {count} giây.",
    other: "Mất kết nối. Thử lại sau {count} giây.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Lần thử kết nối thất bại. Thử lại sau {count} giây.\n{detail}",
    other: "Lần thử kết nối thất bại. Thử lại sau {count} giây.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Lần thử kết nối thất bại. Thử lại sau {count} giây.",
    other: "Lần thử kết nối thất bại. Thử lại sau {count} giây.",
  },
  "status.remote.reconnectingDetail": {
    one: "Đang kết nối lại {attempt}/{count}\n{detail}",
    other: "Đang kết nối lại {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Đang kết nối lại {attempt}/{count}",
    other: "Đang kết nối lại {attempt}/{count}",
  },
  "status.remote.messageCut":
    "[{size} MB của tin nhắn này không hiển thị trên thiết bị này. Hãy mở trên máy tính chạy máy chủ để đọc toàn bộ.]",
} as const satisfies PartialTranslation<typeof source>;
