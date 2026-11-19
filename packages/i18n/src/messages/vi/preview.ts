import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Xem trước tệp",
  "preview.panel.resize": "Đổi kích thước khung xem trước",
  "preview.panel.copy": "Sao chép nội dung tệp",
  "preview.panel.openExternally": "Mở tệp bằng ứng dụng khác",
  "preview.panel.download": "Tải tệp xuống",
  "preview.panel.reveal": "Hiện tệp trong Finder",
  "preview.panel.close": "Đóng xem trước tệp",
  "preview.panel.back": "Quay lại",
  "preview.panel.rawMarkdown": "Xem mã nguồn Markdown",
  "preview.panel.rawHtml": "Xem mã nguồn HTML",
  "preview.panel.wrapLines": "Ngắt dòng dài",
  "preview.folder.empty": "Thư mục này trống.",
  "preview.folder.truncated": "Chỉ hiển thị {limit} mục đầu tiên.",
  "preview.truncated": "Bản xem trước bị cắt sau {limit} ký tự.",
  "preview.unavailable": "Không thể xem trước.",
  "preview.unsupported.title": "Không thể xem trước",
  "preview.unsupported.description": "Bạn có thể mở loại tệp này bằng ứng dụng mặc định.",
  "preview.unsupported.openExternally": "Mở bằng ứng dụng khác",
  "preview.tooLarge.title": "Tệp quá lớn để xem trước",
  "preview.tooLarge.description": "Chỉ xem trước được tệp tối đa 100 MB. Bạn có thể mở tệp này bằng ứng dụng mặc định.",
  "preview.spreadsheet.readFailed": "Không thể đọc bảng tính này.",
  "preview.spreadsheet.truncated": "Bản xem trước chỉ gồm {rows} hàng và {columns} cột đầu tiên.",
} as const satisfies PartialTranslation<typeof source>;
