import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Không thể kết nối. Hãy kiểm tra kết nối mạng rồi thử lại.",
  "error.kind.timeout":
    "Yêu cầu mất quá nhiều thời gian. Hãy kiểm tra xem thao tác đã hoàn tất chưa trước khi thử lại.",
  "error.kind.storage":
    "Không đủ dung lượng lưu trữ. Hãy giải phóng dung lượng trên máy tính đang chạy OpenBot rồi thử lại.",
  "error.kind.filePermission":
    "OpenBot không có quyền thực hiện thao tác này. Hãy kiểm tra quyền của tệp hoặc thư mục rồi thử lại.",
  "error.kind.notFound":
    "Không tìm thấy một tệp hoặc thư mục cần thiết. Hãy khôi phục nó hoặc chọn tệp, thư mục khác rồi thử lại.",
  "error.kind.readOnly": "Thư mục này chỉ cho phép đọc. Hãy chọn một thư mục bạn có thể ghi vào rồi thử lại.",
  "error.kind.conflict": "Đã có một mục trùng tên này. Hãy chọn tên khác rồi thử lại.",
  "error.kind.auth": "Xác thực thất bại. Hãy kiểm tra tài khoản hoặc kết nối máy chủ rồi thử lại.",
  "error.kind.permission": "Bạn không có quyền thực hiện thao tác này. Hãy xin chủ sở hữu cấp quyền truy cập.",
  "error.kind.rateLimit": "Quá nhiều yêu cầu. Hãy chờ một lát rồi thử lại.",
  "error.kind.service": "Dịch vụ hiện không khả dụng. Hãy chờ một lát rồi thử lại.",
} as const satisfies PartialTranslation<typeof source>;
