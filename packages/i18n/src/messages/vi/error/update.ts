import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Bản cập nhật có sẵn cho các bản máy tính đã cài đặt.",
  "error.update.notReady": "Chưa có bản cập nhật sẵn sàng để cài đặt.",
  "error.update.restartFailed": "OpenBot không thể khởi động lại để cài đặt bản cập nhật.",
  "error.update.downloadStalled": "Quá trình tải bản cập nhật đã ngừng phản hồi. Hãy thử lại.",
  "error.update.installFailed": "Không thể cài đặt bản cập nhật. Hãy thoát và mở lại OpenBot, rồi thử lại.",
  "error.update.downloadFailed": "Không thể tải xuống bản cập nhật. Hãy thử lại.",
  "error.update.checkFailed": "Không thể kiểm tra bản cập nhật. Hãy thử lại.",
  "error.update.checkStalled": "Quá trình kiểm tra bản cập nhật đã ngừng phản hồi. Hãy thử lại.",
  "error.update.checkOffline": "Không thể kết nối tới dịch vụ cập nhật. Hãy kiểm tra kết nối internet, rồi thử lại.",
  "error.update.checkUnavailable": "Dịch vụ cập nhật không phản hồi. OpenBot sẽ tự thử lại sau vài phút.",
  "error.update.checkNoRelease":
    "Không tìm thấy bản cập nhật nào đã phát hành cho nền tảng này. OpenBot sẽ tự thử lại sau vài phút.",
  "error.update.managedByNix": "Nix cài đặt bản cập nhật cho bản OpenBot này. Hãy cập nhật bằng Nix.",
  "error.update.managedByHost":
    "Bản cập nhật trên máy Mac này do host cài đặt. Bản cập nhật vẫn sẵn sàng cho đến khi host chạy bảo trì.",
  "error.update.siblingSession":
    "Một phiên OpenBot khác vẫn đang chạy từ ứng dụng này. Hãy dừng OpenBot trong mọi tài khoản người dùng macOS khác trước, rồi cài đặt lại bản cập nhật.",
  "error.update.siblingSessionSameAccount":
    "Một tiến trình OpenBot khác vẫn đang chạy trong tài khoản người dùng này. Hãy thoát tiến trình đó, rồi cài đặt lại bản cập nhật.",
  "error.update.siblingCheckFailed": "Không thể xác minh các phiên OpenBot khác. Hãy thử lại trước khi cài đặt.",
  "error.update.readOnlyLocation":
    "OpenBot không thể cài đặt bản cập nhật từ vị trí này. Hãy thoát OpenBot. Trong Finder, kéo OpenBot vào thư mục Applications (nếu đã có ở đó, hãy kéo ra rồi kéo vào lại). Sau đó mở OpenBot và cài đặt lại bản cập nhật.",
  "error.update.appImageMissing":
    "OpenBot không thể cài đặt bản cập nhật vì tệp AppImage của nó đã bị di chuyển, đổi tên hoặc thay thế. Hãy thoát OpenBot, rồi mở lại tệp AppImage.",
  "error.update.appImageReadOnly":
    "OpenBot không thể cài đặt bản cập nhật trong thư mục chứa tệp AppImage. Hãy thoát OpenBot, di chuyển tệp AppImage vào một thư mục trong thư mục chính của bạn, rồi mở tệp và cài đặt lại bản cập nhật.",
  "error.update.remoteDisabled": "Cập nhật từ quản trị viên máy chủ đã bị tắt trên máy tính này.",
  "error.update.restartStarted": "OpenBot đang khởi động lại để cài đặt bản cập nhật.",
  "error.update.alreadyRestarting": "OpenBot đang khởi động lại.",
} as const satisfies PartialTranslation<typeof source>;
