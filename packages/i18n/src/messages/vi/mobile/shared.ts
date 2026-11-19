import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Chọn",
  "mobile.shared.crop.label": "Cắt ảnh",
  "mobile.shared.crop.hint": "Kéo để di chuyển ảnh. Chụm hai ngón để thu phóng.",
  "mobile.shared.splash.loading": "Đang tải tài khoản",
  "mobile.shared.photo.openFailed": "Không thể mở ảnh này. Hãy thử lại.",
  "mobile.shared.photo.tooLarge": "OpenBot không thể thu nhỏ ảnh này đủ mức. Hãy chọn một ảnh đơn giản hơn.",
  "mobile.shared.save.changes": "Lưu thay đổi",
} as const satisfies PartialTranslation<typeof source>;
