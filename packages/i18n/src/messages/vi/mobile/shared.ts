import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Chọn",
  "mobile.shared.crop.label": "Cắt ảnh",
  "mobile.shared.crop.hint": "Kéo để di chuyển ảnh. Vuốt để thu phóng.",
  "mobile.shared.splash.loading": "Đang tải tài khoản",
  "mobile.shared.photo.openFailed": "Không thể mở ảnh này. Hãy thử lại.",
  "mobile.shared.photo.tooLarge": "OpenBot không thể làm nhỏ ảnh này đủ. Hãy chọn ảnh đơn giản hơn.",
  "mobile.shared.save.changes": "Lưu thay đổi",
} as const satisfies PartialTranslation<typeof source>;
