import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Không thể truy cập địa chỉ này bằng tên.",
  "error.mcp.redirectNotSignIn": "Địa chỉ này không thuộc một lượt đăng nhập nào.",
  "error.mcp.redirectRefused": "Đăng nhập đã bị từ chối. Hãy quay lại OpenBot và thử lại.",
  "error.mcp.redirectNoSignIn": "Không có lượt đăng nhập nào đang chờ địa chỉ này. Có thể lượt đăng nhập đã kết thúc.",
  "error.mcp.redirectSignedIn": "OpenBot đã đăng nhập. Bạn có thể đóng cửa sổ này.",
  "error.mcp.signInFileUnreadable": "Không đọc được tệp đăng nhập MCP.",
  "error.mcp.signInFileTooLarge": "Tệp đăng nhập MCP quá lớn.",
  "error.mcp.unsupported": "Máy chủ này không hỗ trợ máy chủ MCP.",
  "error.mcp.signInOnHost": "Chỉ có thể đăng nhập vào máy chủ MCP trong OpenBot trên máy tính host.",
  "error.mcp.signInPageOnServer":
    "Trang đăng nhập này chỉ mở trên máy chủ. Hãy nhờ chủ sở hữu hoặc quản trị viên của máy chủ đăng nhập.",
  "error.mcp.signInPageOnServerSwitch":
    "Trang đăng nhập này chỉ mở trên máy chủ. Hãy chuyển sang máy chủ này, rồi chọn lại Đăng nhập.",
  "error.mcp.signInAppUnsupported": "Máy chủ này không hỗ trợ ứng dụng đăng nhập. Hãy cập nhật OpenBot trên host.",
  "error.mcp.redirectRelayed": "OpenBot đã gửi lượt đăng nhập đến máy chủ. Bạn có thể đóng cửa sổ này.",
  "error.mcp.relayEnded": "Lượt đăng nhập này đã kết thúc. Hãy bắt đầu lại.",
  "error.mcp.relayNoState":
    "Trang đăng nhập của máy chủ không bảo vệ địa chỉ trả về, nên OpenBot không mở trang này trên máy tính này.",
  "error.mcp.relayAddressInvalid":
    "Đây không phải là địa chỉ ở cuối lượt đăng nhập này. Hãy sao chép toàn bộ địa chỉ từ trình duyệt.",
} as const satisfies PartialTranslation<typeof source>;
