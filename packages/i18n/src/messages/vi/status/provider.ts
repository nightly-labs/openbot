import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  // Provider runtime download status.
  "status.provider.downloadStopped": "Đã dừng tải xuống. Hãy thử lại.",
  "status.provider.downloadFailed": "Tải xuống thất bại. Hãy thử lại.",
  "status.provider.updateWaiting": "Bản cập nhật bắt đầu khi lượt hiện tại kết thúc.",
  "status.provider.confirmContinue": "Tiếp tục",
  "status.provider.confirmCancel": "Hủy",
  // A provider that tries a failed API request again during a turn.
  "status.provider.retryUnreachable":
    "{provider} không thể kết nối tới máy chủ của nó. Thử lại lần {attempt} trên {maxAttempts}.",
  "status.provider.retryServerError":
    "Máy chủ {provider} đang bận hoặc gặp lỗi. Thử lại lần {attempt} trên {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} đã nhận lại câu trả lời từ máy chủ của nó.",
  // Claude Code ran a fast mode turn at the standard speed, with the reason.
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh với gói đăng ký Claude dùng tính dụng. Hãy bật tính dụng trong tài khoản Claude của bạn.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Gói Claude của bạn không bao gồm chế độ nhanh.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh chỉ hoạt động với khóa API Anthropic hoặc gói đăng ký Claude, không hoạt động với Bedrock, Vertex, Foundry hay cổng kết nối.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Mô hình này không dùng được chế độ nhanh trên tài khoản của bạn.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh đã bị tắt trong cài đặt Claude Code hoặc bởi tổ chức của bạn.",
  "status.provider.claudeFastModeUnavailable":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Claude Code không thể dùng chế độ nhanh cho lượt này.",
} as const satisfies PartialTranslation<typeof source>;
