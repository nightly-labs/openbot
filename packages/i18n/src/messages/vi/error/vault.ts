import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "Máy tính này không có bộ lưu trữ bí mật, nên Kho bảo mật không lưu được mục nào.",
  "error.vault.unreadable": "Không đọc được tệp Kho bảo mật. Hãy đặt lại Kho bảo mật để dùng tiếp.",
  "error.vault.tooLarge": "Kho bảo mật đã đầy. Hãy xóa bớt một số mục, rồi thử lại.",
  "error.vault.itemMissing": "Mục này không còn trong Kho bảo mật.",
  "error.vault.valueTooLong": "Một giá trị quá dài.",
  "error.vault.websiteInvalid": "Hãy nhập địa chỉ trang web HTTPS.",
  "error.vault.passwordRequired": "Hãy nhập mật khẩu.",
  "error.vault.twoStepKeyInvalid":
    "Đây không phải là khóa xác minh hai bước. Hãy nhập khóa thiết lập hoặc liên kết otpauth:// của trang web.",
  "error.vault.cardNumberInvalid": "Hãy nhập số thẻ hợp lệ.",
  "error.vault.securityCodeInvalid": "Hãy nhập mã bảo mật gồm 3 hoặc 4 chữ số.",
  "error.vault.expiryInvalid": "Hãy nhập tháng và năm hết hạn hợp lệ.",
  "error.vault.contactEmpty": "Hãy nhập tên, địa chỉ, số điện thoại hoặc địa chỉ email.",
  "error.vault.contactMissing": "Thông tin liên hệ thanh toán không còn trong Kho bảo mật.",
  "error.vault.apiKeyRequired": "Hãy nhập khóa API.",
  "error.vault.apiKeyNameInvalid":
    "Hãy nhập tên biến gồm chữ in hoa A–Z, chữ số và _, bắt đầu bằng một chữ cái, ví dụ OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "Kho bảo mật đã có khóa API với tên biến này.",
  "error.vault.apiKeyAgentTaken": "Một agent bạn đã chọn đã có khóa API với tên biến này.",
  "error.vault.agentsRequired": "Hãy chọn ít nhất một agent.",
  "error.vault.csvInvalid": "Tệp này không phải là tệp xuất mật khẩu ở định dạng CSV.",
  "error.vault.csvTooLarge": "Tệp CSV quá lớn.",
} as const satisfies PartialTranslation<typeof source>;
