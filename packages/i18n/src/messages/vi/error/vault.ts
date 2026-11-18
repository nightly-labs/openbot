import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  // The Vault of this computer: its encrypted file and the items that the user saves in it.
  "error.vault.unavailable": "Máy tính này không có kho lưu bí mật, nên Kho không thể lưu mục.",
  "error.vault.unreadable": "Không thể đọc tệp Kho. Hãy đặt lại Kho để dùng lại.",
  "error.vault.tooLarge": "Kho đã đầy. Hãy xóa bớt mục, rồi thử lại.",
  "error.vault.itemMissing": "Mục này không còn trong Kho.",
  "error.vault.valueTooLong": "Một giá trị quá dài.",
  "error.vault.websiteInvalid": "Nhập địa chỉ trang web HTTPS.",
  "error.vault.passwordRequired": "Nhập mật khẩu.",
  "error.vault.twoStepKeyInvalid":
    "Đây không phải khóa xác thực hai bước. Hãy nhập khóa thiết lập hoặc liên kết otpauth:// của trang web.",
  "error.vault.cardNumberInvalid": "Nhập số thẻ hợp lệ.",
  "error.vault.securityCodeInvalid": "Nhập mã bảo mật gồm 3 hoặc 4 chữ số.",
  "error.vault.expiryInvalid": "Nhập tháng và năm hết hạn hợp lệ.",
  "error.vault.contactEmpty": "Nhập tên, địa chỉ, số điện thoại hoặc địa chỉ email.",
  "error.vault.contactMissing": "Liên hệ thanh toán không còn trong Kho.",
  "error.vault.apiKeyRequired": "Nhập khóa API.",
  "error.vault.apiKeyNameInvalid":
    "Nhập tên biến gồm chữ hoa A–Z, chữ số và _, bắt đầu bằng chữ cái, chẳng hạn OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "Kho đã có khóa API với tên biến này.",
  "error.vault.csvInvalid": "Tệp này không phải bản xuất mật khẩu ở định dạng CSV.",
  "error.vault.csvTooLarge": "Tệp CSV quá lớn.",
} as const satisfies PartialTranslation<typeof source>;
