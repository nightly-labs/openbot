import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – المضيف المحلي",
  "window.localClientTitle": "OpenBot – العميل المحلي",
  "window.computerUsePermissionTitle": "تشغيل التحكم في الحاسوب",
  "window.controls.label": "النافذة",
  "window.controls.minimize": "تصغير",
  "window.controls.maximize": "تكبير",
  "window.controls.restore": "استعادة",
  "window.controls.close": "إغلاق",
} as const satisfies PartialTranslation<typeof source>;
