import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Xem trước tệp",
  "preview.panel.resize": "Đổi kích thước khung xem trước tệp",
  "preview.panel.copy": "Sao chép nội dung tệp",
  "preview.panel.openExternally": "Mở tệp bằng ứng dụng khác",
  "preview.panel.download": "Tải tệp xuống",
  "preview.panel.reveal": "Hiện tệp trong Finder",
  "preview.panel.close": "Đóng khung xem trước tệp",
  "preview.panel.back": "Quay lại",
  "preview.panel.rawMarkdown": "Hiện mã nguồn Markdown",
  "preview.panel.rawHtml": "Hiện mã nguồn HTML",
  "preview.panel.wrapLines": "Ngắt dòng dài",
  "preview.folder.empty": "Thư mục này trống.",
  "preview.folder.truncated": "Chỉ hiển thị {limit} mục đầu tiên.",
  "preview.truncated": "Xem trước bị cắt sau {limit} ký tự.",
  "preview.unavailable": "Không thể xem trước.",
  "preview.unsupported.title": "Không thể xem trước",
  "preview.unsupported.description": "Loại tệp này có thể mở bằng ứng dụng mặc định của nó.",
  "preview.unsupported.openExternally": "Mở bằng ứng dụng khác",
  "preview.spreadsheet.readFailed": "Không thể đọc bảng tính này.",
  "preview.spreadsheet.truncated": "Xem trước chỉ giới hạn ở {rows} hàng và {columns} cột đầu tiên.",
} as const satisfies PartialTranslation<typeof source>;
