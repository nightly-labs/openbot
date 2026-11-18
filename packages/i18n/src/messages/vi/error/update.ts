import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Updater state the user reads.
  "error.update.unsupported": "Cập nhật chỉ khả dụng trong các bản dựng để bàn đã cài đặt.",
  "error.update.notReady": "Bản cập nhật chưa sẵn sàng để cài đặt.",
  "error.update.restartFailed": "OpenBot không thể khởi động lại để cài đặt bản cập nhật.",
  "error.update.downloadStalled": "Việc tải xuống bản cập nhật ngừng phản hồi. Hãy thử lại.",
  "error.update.installFailed": "Không thể cài đặt bản cập nhật. Thoát và mở lại OpenBot, rồi thử lại.",
  "error.update.downloadFailed": "Không thể tải xuống bản cập nhật. Hãy thử lại.",
  "error.update.checkFailed": "Không thể kiểm tra bản cập nhật. Hãy thử lại.",
  "error.update.checkStalled": "Việc kiểm tra bản cập nhật ngừng phản hồi. Hãy thử lại.",
  "error.update.checkOffline": "Không thể kết nối dịch vụ cập nhật. Kiểm tra kết nối internet của bạn, rồi thử lại.",
  "error.update.checkUnavailable": "Dịch vụ cập nhật không trả lời. OpenBot sẽ tự thử lại sau vài phút.",
  "error.update.checkNoRelease":
    "Không tìm thấy bản cập nhật đã xuất bản cho nền tảng này. OpenBot sẽ tự thử lại sau vài phút.",
  "error.update.managedByNix": "Nix cài đặt bản cập nhật cho bản OpenBot này. Hãy cập nhật bằng Nix.",
  "error.update.managedByHost":
    "Các bản cập nhật trên Mac này do máy tính cài đặt. Bản cập nhật vẫn sẵn sàng cho đến khi quá trình bảo trì của máy tính chạy.",
  "error.update.siblingSession":
    "Một phiên OpenBot khác vẫn đang chạy từ ứng dụng này. Hãy dừng OpenBot trong mọi tài khoản người dùng macOS khác trước, rồi cài đặt lại bản cập nhật.",
  "error.update.siblingSessionSameAccount":
    "Một tiến trình OpenBot khác vẫn đang chạy trong tài khoản người dùng này. Hãy thoát nó, rồi cài đặt lại bản cập nhật.",
  "error.update.siblingCheckFailed": "Không thể xác minh các phiên OpenBot khác. Hãy thử lại trước khi cài đặt.",
  "error.update.readOnlyLocation":
    "OpenBot không thể cài đặt bản cập nhật từ vị trí này. Hãy thoát OpenBot. Trong Finder, kéo OpenBot vào thư mục Applications (nếu nó đã ở đó, hãy kéo ra rồi kéo lại vào). Sau đó mở OpenBot và cài đặt lại bản cập nhật.",
  // A joined server's admin reads these from the host.
  "error.update.remoteDisabled": "Cập nhật từ quản trị viên máy chủ đã bị tắt trên máy tính này.",
  "error.update.restartStarted": "OpenBot đã khởi động lại để cài đặt bản cập nhật.",
  "error.update.alreadyRestarting": "OpenBot đã khởi động lại.",
} as const satisfies PartialTranslation<typeof source>;
