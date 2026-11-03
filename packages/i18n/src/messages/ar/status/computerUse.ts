import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "لم يبدأ مشغّل التحكم في الحاسوب. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "توقف مشغّل التحكم في الحاسوب قبل أن يرد.",
  "status.computerUse.driverNoAnswer": "لم يرد مشغّل التحكم في الحاسوب. {reason}",
  "status.computerUse.driverStopped": "توقف مشغّل التحكم في الحاسوب.",
  "status.computerUse.unsupported": "التحكم في الحاسوب متاح على macOS وWindows وLinux.",
  "status.computerUse.driverMissing": "لا يتضمن هذا الإصدار من OpenBot مشغّل التحكم في الحاسوب.",
  "status.computerUse.progressActing": "جارٍ استخدام تطبيق على هذا الحاسوب…",
  "status.computerUse.progressDeciding": "جارٍ تحديد الخطوة التالية في التطبيق…",
} as const satisfies PartialTranslation<typeof source>;
