import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Không thể thay đổi gói máy chủ. Hãy làm mới Thanh toán và thử lại.",
  "error.billing.confirmMismatch": "Nhập tên máy chủ để xóa nó.",
  "error.billing.restartBusy": "Máy chủ không thể khởi động lại bây giờ. Hãy thử lại sau một phút.",
  "error.billing.planRequired": "Gói của máy chủ này đã hết hạn. Hãy gia hạn để khởi động máy chủ.",
  "error.billing.planSoldOut": "Gói này đã hết. Hãy chọn gói khác.",
  // License errors.
  "error.billing.licenseExists": "Tài khoản này đã có giấy phép. Hãy thay đổi số người dùng của nó.",
  "error.billing.licenseCurrency": "Giấy phép phải dùng tiền tệ của các gói khác của bạn.",
  "error.billing.planCurrency": "Gói mới phải dùng tiền tệ của các gói khác của bạn.",
  "error.billing.licenseUsersInUse": "Giấy phép không thể có số người dùng ít hơn số người đang dùng.",
  "error.billing.licensePaymentFailed":
    "Thanh toán cho người dùng đã thêm không thành công. Hãy cập nhật phương thức thanh toán và thử lại.",
  "error.billing.licenseUnavailable": "Hiện không có giấy phép khả dụng.",
  "error.billing.licenseOneUser": "Giấy phép này dành cho 1 người dùng. Hãy đổi sang Team để thêm người dùng.",
  "error.billing.licensePlanChange": "Không thể đổi giấy phép này sang gói đó. Hãy hủy nó và mua gói mới.",
  "error.billing.noLicense": "Tài khoản này không có giấy phép.",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "Yêu cầu thanh toán không hợp lệ.",
  "error.billing.invalidResponse": "Phản hồi thanh toán không hợp lệ.",
  "error.billing.notStripePage": "Trang thanh toán không phải trang Stripe.",
} as const satisfies PartialTranslation<typeof source>;
