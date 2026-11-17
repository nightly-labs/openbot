import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "لم يبدأ مشغّل التحكم في الحاسوب. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "توقف مشغّل التحكم في الحاسوب قبل أن يرد.",
  "status.computerUse.driverNoAnswer": "لم يرد مشغّل التحكم في الحاسوب. {reason}",
  "status.computerUse.driverStopped": "توقف مشغّل التحكم في الحاسوب.",
  "status.computerUse.unsupported": "التحكم في الحاسوب متاح على macOS وWindows وLinux.",
  "status.computerUse.driverMissing": "لا يتضمن هذا الإصدار من OpenBot مشغّل التحكم في الحاسوب.",
  "status.computerUse.restartRequired":
    "لا يزال macOS يمنع OpenBot من النقر والكتابة، رغم تفعيل الإذنين. أعد تشغيل OpenBot. إذا تكرر ذلك، فانقر على «إدارة» بجانب «إمكانية الوصول»، وأزل OpenBot من القائمة، وأضفه مرة أخرى، ثم أعد تشغيل OpenBot.",
  "status.computerUse.progressActing": "جارٍ استخدام تطبيق على هذا الحاسوب…",
  "status.computerUse.progressDeciding": "جارٍ تحديد الخطوة التالية في التطبيق…",
} as const satisfies PartialTranslation<typeof source>;
