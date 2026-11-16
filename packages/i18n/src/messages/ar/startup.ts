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
  "startup.filesDamagedBody":
    "بعض ملفات OpenBot تالفة أو مفقودة.\n\nلإصلاح OpenBot، ثبّته من جديد. تبقى بياناتك المحلية.",
  "startup.newerDataUpdatingTitle": "جارٍ تحديث OpenBot",
  "startup.newerDataUpdatingBody":
    "حفظ إصدار أحدث من OpenBot بياناتك. يثبّت OpenBot أحدث إصدار ثم يفتح مرة أخرى.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataTitle": "ثبّت أحدث إصدار من OpenBot",
  "startup.newerDataBody":
    "حفظ إصدار أحدث من OpenBot بياناتك، ولا يستطيع هذا الإصدار ({version}) فتحها. ثبّت أحدث إصدار لفتح بياناتك.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataDownload": "تنزيل OpenBot",
  "startup.newerDataGuide": "فتح الدليل",
  "startup.newerDataQuit": "إنهاء",
  "startup.recoveryWindowTitle": "استرداد OpenBot",
  "startup.recoveryTitle": "لم يُفتح OpenBot",
  "startup.recoveryBody": {
    zero: "توقف OpenBot {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    one: "توقف OpenBot {version} قبل أن يُفتح مرة واحدة ({count}). لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    two: "توقف OpenBot {version} قبل أن يُفتح مرتين متتاليتين ({count}). لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    few: "توقف OpenBot {version} قبل أن يُفتح {count} مرات متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    many: "توقف OpenBot {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
    other:
      "توقف OpenBot {version} قبل أن يُفتح {count} مرة متتالية. لم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  },
  "startup.recoveryHint":
    "أعد المحاولة، أو ثبّت آخر إصدار فُتح. للحصول على المساعدة، صدّر بيانات التشخيص وأرسل الملف مع بلاغك.",
  "startup.recoveryRetry": "إعادة المحاولة",
  "startup.recoveryPreviousVersion": "تنزيل الإصدار السابق",
  "startup.recoveryExportDiagnostics": "تصدير التشخيص",
  "startup.recoveryOpenDataFolder": "فتح مجلد البيانات",
  "startup.recoveryQuit": "إنهاء",
  "startup.recoveryDiagnosticsSaved": "تم حفظ ملف التشخيص.",
  "startup.recoveryActionFailed": "تعذّر على OpenBot تنفيذ هذا الإجراء.",
} as const satisfies PartialTranslation<typeof source>;
