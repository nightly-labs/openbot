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
} as const satisfies PartialTranslation<typeof source>;
