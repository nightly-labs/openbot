import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/uiBlock";

export const messages = {
  "uiBlock.status.answered": "Đã trả lời",
  "uiBlock.status.waiting": "Đang chờ bạn",
  "uiBlock.outcome.expired": "Không có câu trả lời trong thời hạn",
  "uiBlock.outcome.closed": "Đã đóng mà không có câu trả lời",
  "uiBlock.outcome.autoAnswered": "{outcome} (không ai trả lời kịp)",
  "uiBlock.confirm.holdHint": "Giữ nút để xác nhận, hoặc nhấn nút để xác nhận ở bước thứ hai",
  "uiBlock.confirm.prompt": "Xác nhận: {action}?",
  "uiBlock.confirm.accept": "Xác nhận",
  "uiBlock.confirm.autoActionLabel": "{action} · {seconds} s",
  "uiBlock.confirm.autoActionClock": "{action} · {time}",
  "uiBlock.confirm.previewLabel": "Xem trước",
  "uiBlock.confirm.showFullPreview": "Xem tất cả",
  "uiBlock.confirm.hideFullPreview": "Xem ít hơn",
  "uiBlock.choice.submit": "Gửi",
  "uiBlock.choice.shortcutHint": "Nhấn {first} đến {last} để chọn",
  "uiBlock.quick.label": "Trả lời nhanh",
  "uiBlock.form.submit": "Gửi",
  "uiBlock.form.required": "Trường này là bắt buộc",
  "uiBlock.form.choose": "Chọn một tùy chọn",
  "uiBlock.form.notSet": "Chưa đặt",
  "uiBlock.form.invalid": "Một số câu trả lời chưa đúng. Hãy kiểm tra rồi thử lại.",
  "uiBlock.form.hiddenValue": "Đã ẩn",
  "uiBlock.skip": "Bỏ qua",
  "uiBlock.error.answerFailed": "Không thể gửi câu trả lời của bạn. Hãy thử lại.",
} as const satisfies PartialTranslation<typeof source>;
