import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "تعذّر بدء تشغيل OpenBot",
  "startup.failedBody":
    "{message}\n\nلم تُعَد تعيين بياناتك المحلية ولم يُكتب فوقها. راجع دليل استكشاف الأخطاء وإصلاحها لمعرفة خطوات الاسترداد.",
  "startup.archiveChangedTitle": "تم تغيير ملفات OpenBot",
  "startup.archiveChangedBody":
    "غيّر برنامج آخر ملف OpenBot المسمى app.asar. يعمل OpenBot الآن، لكنه لن يفتح بعد إنهائه.\n\nلإصلاح OpenBot، ثبّته من جديد. تبقى بياناتك المحلية.",
  "startup.archiveChangedDownload": "تنزيل OpenBot",
  "startup.newerDataUpdatingTitle": "جارٍ تحديث OpenBot",
  "startup.newerDataUpdatingBody":
    "حفظ إصدار أحدث من OpenBot بياناتك. يثبّت OpenBot أحدث إصدار ثم يفتح مرة أخرى.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataTitle": "ثبّت أحدث إصدار من OpenBot",
  "startup.newerDataBody":
    "حفظ إصدار أحدث من OpenBot بياناتك، ولا يستطيع هذا الإصدار ({version}) فتحها. ثبّت أحدث إصدار لفتح بياناتك.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataDownload": "تنزيل OpenBot",
  "startup.newerDataGuide": "فتح الدليل",
  "startup.newerDataQuit": "إنهاء",
} as const satisfies PartialTranslation<typeof source>;
