import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Đã dừng tải xuống. Hãy thử lại.",
  "status.provider.downloadFailed": "Tải xuống thất bại. Hãy thử lại.",
  "status.provider.updateWaiting": "Bản cập nhật sẽ bắt đầu khi lượt hiện tại kết thúc.",
  "status.provider.confirmContinue": "Tiếp tục",
  "status.provider.confirmCancel": "Hủy",
  "status.provider.retryUnreachable":
    "{provider} không thể kết nối tới máy chủ của mình. Thử lại lần {attempt}/{maxAttempts}.",
  "status.provider.retryServerError": "Máy chủ {provider} đang bận hoặc gặp lỗi. Thử lại lần {attempt}/{maxAttempts}.",
  "status.provider.modelRetryUnreachable":
    "{provider} không thể kết nối tới nhà cung cấp mô hình. Đang thử lại: lần {attempt}.",
  "status.provider.modelRetryServerError":
    "Nhà cung cấp mô hình đang bận hoặc gặp lỗi. {provider} đang thử lại: lần {attempt}.",
  "status.provider.modelRetryRecovered": "Nhà cung cấp mô hình đã phản hồi trở lại.",
  "status.provider.retryRecovered": "{provider} đã nhận được phản hồi từ máy chủ của mình trở lại.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh với gói Claude sẽ dùng tín dụng sử dụng. Hãy bật tín dụng này trong tài khoản Claude của bạn.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Gói Claude của bạn không bao gồm chế độ nhanh.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh chỉ hoạt động với khóa API Anthropic hoặc gói Claude, không hoạt động với Bedrock, Vertex, Foundry hay gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Mô hình này không thể dùng chế độ nhanh trên tài khoản của bạn.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Chế độ nhanh đã bị tắt trong cài đặt Claude Code hoặc bởi tổ chức của bạn.",
  "status.provider.claudeFastModeUnavailable":
    "Claude đã trả lời ở tốc độ tiêu chuẩn. Claude Code không thể dùng chế độ nhanh cho lượt này.",
  "status.provider.claudeOwnApiKey":
    "Claude Code đang được đặt để dùng khóa API Anthropic. Anthropic tính phí mỗi yêu cầu vào tín dụng API của khóa đó, không tính vào gói Claude của bạn. Để dùng gói của bạn, hãy xóa khóa khỏi cài đặt Claude Code hoặc khỏi biến môi trường, rồi khởi động lại OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
