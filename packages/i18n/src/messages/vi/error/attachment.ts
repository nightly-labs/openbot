import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.notFound": "Không tìm thấy tệp đính kèm.",
  "error.attachment.fileTooLarge": "Một tệp vượt quá giới hạn 100 MB.",
  "error.attachment.totalTooLarge": "Tệp đính kèm vượt quá giới hạn tổng 250 MB.",
  "error.attachment.unavailable": "Tệp này không còn khả dụng.",
  "error.attachment.tooMany": "Chọn tối đa {limit} tệp.",
  "error.attachment.mediaUnsupported":
    "Máy chủ này không hỗ trợ tệp đính kèm MP3 hoặc MOV. Hãy cập nhật OpenBot trên máy tính chủ và thử lại.",
  "error.attachment.emlUnsupported":
    "Máy chủ này không hỗ trợ tệp đính kèm EML. Hãy cập nhật OpenBot trên máy tính chủ và thử lại.",
  "error.attachment.zipUnsupported":
    "Máy chủ này không hỗ trợ tệp đính kèm ZIP. Hãy cập nhật OpenBot trên máy tính chủ và thử lại.",
  "error.attachment.mp4Unsupported":
    "Máy chủ này không hỗ trợ tệp đính kèm MP4. Hãy cập nhật OpenBot trên máy tính chủ và thử lại.",
  "error.attachment.svgUnsupported":
    "Máy chủ này không hỗ trợ tệp đính kèm SVG. Hãy cập nhật OpenBot trên máy tính chủ và thử lại.",
  "error.attachment.previewTooLarge": "Tệp vượt quá giới hạn 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
