import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – المضيف المحلي",
  "window.localClientTitle": "OpenBot – العميل المحلي",
  "window.computerUsePermissionTitle": "تشغيل التحكم في الحاسوب",
  "window.rendererStoppedTitle": "توقف OpenBot عن العمل",
  "window.rendererStoppedBody": "توقفت النافذة عدة مرات. محادثاتك محفوظة، ووكلاؤك يواصلون العمل.",
  "window.rendererStoppedReload": "إعادة التحميل",
  "window.minimize": "تصغير",
  "window.maximize": "تكبير",
  "window.restore": "استعادة",
} as const satisfies PartialTranslation<typeof source>;
