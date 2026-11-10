import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "Không thể truy cập địa chỉ này theo tên.",
  "error.mcp.redirectGetOnly": "Địa chỉ này chỉ trả lời GET.",
  "error.mcp.redirectNotSignIn": "Địa chỉ này không thuộc một lần đăng nhập.",
  "error.mcp.redirectRefused": "Lượt đăng nhập đã bị từ chối. Hãy quay lại OpenBot và thử lại.",
  "error.mcp.redirectNoSignIn": "Không có lượt đăng nhập nào đang chờ. Nó có thể đã kết thúc.",
  "error.mcp.redirectSignedIn": "OpenBot đã đăng nhập. Bạn có thể đóng cửa sổ này.",
  "error.mcp.signInFileUnreadable": "Không thể đọc tệp đăng nhập MCP.",
  "error.mcp.signInFileTooLarge": "Tệp đăng nhập MCP quá lớn.",
  "error.mcp.unsupported": "Máy chủ này không hỗ trợ máy chủ MCP.",
  "error.mcp.signInOnHost": "Đăng nhập máy chủ MCP chỉ hoạt động trong OpenBot trên máy tính chủ.",
  "error.mcp.signInAppUnsupported":
    "Máy chủ này không hỗ trợ ứng dụng đăng nhập. Hãy cập nhật OpenBot trên máy tính chủ.",
  "error.mcp.redirectRelayed": "OpenBot đã gửi lượt đăng nhập đến máy chủ. Bạn có thể đóng cửa sổ này.",
  "error.mcp.relayEnded": "Lượt đăng nhập này đã kết thúc. Hãy bắt đầu lại.",
  "error.mcp.relayNoState":
    "Trang đăng nhập của máy chủ không bảo vệ địa chỉ trả về, nên OpenBot không mở nó trên máy tính này.",
  "error.mcp.relayAddressInvalid":
    "Đây không phải địa chỉ ở cuối lượt đăng nhập này. Hãy sao chép địa chỉ đầy đủ từ trình duyệt.",
} as const satisfies PartialTranslation<typeof source>;
