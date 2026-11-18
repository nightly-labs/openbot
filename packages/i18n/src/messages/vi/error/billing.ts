import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Không thể thay đổi gói máy chủ. Hãy làm mới Thanh toán rồi thử lại.",
  "error.billing.confirmMismatch": "Hãy nhập tên máy chủ để xóa máy chủ đó.",
  "error.billing.restartBusy": "Máy chủ hiện không thể khởi động lại. Hãy thử lại sau một phút.",
  "error.billing.restartUnavailable": "Không thể khởi động lại máy chủ này từ đây. Hãy liên hệ bộ phận hỗ trợ.",
  "error.billing.planRequired": "Gói của máy chủ này đã hết hạn. Hãy gia hạn để khởi động máy chủ.",
  "error.billing.planSoldOut": "Gói này đã hết. Hãy chọn gói khác.",
  "error.billing.storageUnavailable": "Dung lượng lưu trữ này không khả dụng cho máy chủ này.",
  "error.billing.storagePaymentFailed":
    "Thanh toán cho dung lượng lưu trữ không thành công. Hãy cập nhật phương thức thanh toán rồi thử lại.",
  "error.billing.licenseExists": "Tài khoản này đã có giấy phép. Hãy thay đổi số người dùng của giấy phép đó.",
  "error.billing.licenseCurrency": "Giấy phép phải dùng cùng loại tiền tệ với các gói khác của bạn.",
  "error.billing.planCurrency": "Gói mới phải dùng cùng loại tiền tệ với các gói khác của bạn.",
  "error.billing.licenseUsersInUse": "Số người dùng của giấy phép không thể ít hơn số người đang dùng giấy phép.",
  "error.billing.licensePaymentFailed":
    "Thanh toán cho người dùng được thêm không thành công. Hãy cập nhật phương thức thanh toán rồi thử lại.",
  "error.billing.licenseUnavailable": "Hiện chưa thể mua giấy phép.",
  "error.billing.licenseOneUser": "Giấy phép này dành cho 1 người dùng. Hãy đổi sang Team để thêm người dùng.",
  "error.billing.licensePlanChange": "Không thể chuyển giấy phép này sang gói đó. Hãy hủy giấy phép rồi mua gói mới.",
  "error.billing.noLicense": "Tài khoản này chưa có giấy phép.",
  "error.billing.countryRequired":
    "Hãy cho biết quốc gia thanh toán trước khi trả tiền. Hãy cập nhật OpenBot để làm việc này, rồi thử lại.",
  "error.billing.detailsInvalid": "Hãy kiểm tra quốc gia và mã số VAT. Mã số VAT phải thuộc quốc gia đã chọn.",
  "error.billing.vatIdInvalid":
    "Hệ thống VAT của EU không nhận ra mã số VAT này. Hãy kiểm tra lại số, hoặc tiếp tục mà không có mã số VAT.",
  "error.billing.vatIdUnverified":
    "Hệ thống VAT của EU hiện không thể kiểm tra mã số VAT. Hãy thử lại sau, hoặc tiếp tục mà không có mã số VAT.",
  "error.billing.vatUnavailable": "Hiện chưa thể thanh toán. Hãy thử lại sau.",
  "error.billing.invalidRequest": "Yêu cầu thanh toán không hợp lệ.",
  "error.billing.invalidResponse": "Phản hồi thanh toán không hợp lệ.",
  "error.billing.notStripePage": "Trang thanh toán không phải là trang Stripe.",
} as const satisfies PartialTranslation<typeof source>;
