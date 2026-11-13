import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Không thể kết nối. Kiểm tra kết nối của bạn và thử lại.",
  "error.kind.timeout": "Yêu cầu mất quá lâu. Kiểm tra xem hành động đã hoàn tất chưa trước khi thử lại.",
  "error.kind.storage":
    "Không đủ dung lượng lưu trữ. Hãy giải phóng một phần dung lượng trên máy tính chạy OpenBot, rồi thử lại.",
  "error.kind.filePermission":
    "OpenBot không có quyền hoàn tất hành động này. Kiểm tra quyền của tệp hoặc thư mục, rồi thử lại.",
  "error.kind.notFound": "Không tìm thấy tệp hoặc thư mục cần thiết. Hãy khôi phục nó hoặc chọn tệp khác, rồi thử lại.",
  "error.kind.readOnly": "Thư mục này ở chế độ chỉ đọc. Hãy chọn thư mục mà bạn có thể ghi, rồi thử lại.",
  "error.kind.conflict": "Đã có mục với tên này. Hãy chọn tên khác, rồi thử lại.",
  "error.kind.auth": "Xác thực thất bại. Kiểm tra tài khoản hoặc kết nối máy chủ của bạn, rồi thử lại.",
  "error.kind.permission": "Bạn không có quyền hoàn tất hành động này. Hãy nhờ chủ sở hữu cấp quyền truy cập.",
  "error.kind.rateLimit": "Quá nhiều yêu cầu. Hãy chờ một chút, rồi thử lại.",
  "error.kind.service": "Dịch vụ không khả dụng. Hãy chờ một chút, rồi thử lại.",
} as const satisfies PartialTranslation<typeof source>;
