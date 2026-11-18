import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Mở tệp",
  "attachment.preview": "Xem trước {name}",
  "attachment.notFound": "Không tìm thấy tệp",
  "attachment.download": "Tải xuống {name}",
  "attachment.downloadProgress": "{received} trên {total}",
  "attachment.stopDownload": "Dừng tải xuống {name}, {percent}%",
  "attachment.downloadFailed": "Tải xuống thất bại",
  "attachment.retryDownload": "Thử tải xuống {name} lại",
  "attachment.open": "Mở {name}",
  "attachment.loadMedia": "Phát {name}",
  "attachment.previewUnavailable": "Không thể xem trước.",
  "attachment.error.preview": "Không thể xem trước {name}. Hãy thử lại.",
  "attachment.error.download": "Không thể tải xuống tệp đính kèm. Hãy thử lại.",
  "attachment.error.open": "Không thể mở hoặc lưu tệp đính kèm này. Hãy thử lại.",
  "attachment.error.openFile": "Không thể mở tệp này. Hãy thử lại.",
  "attachment.error.fileFallback": "Tệp",
  "attachment.error.fileNotFound": "Không tìm thấy “{name}” tại đường dẫn này. Tệp có thể đã được di chuyển hoặc xóa.",
  "attachment.error.previewFile": "Không thể xem trước “{name}”. Hãy thử lại.",
} as const satisfies PartialTranslation<typeof source>;
