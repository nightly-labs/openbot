import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "فتح الملف",
  "attachment.preview": "معاينة {name}",
  "attachment.notFound": "لم يتم العثور على الملف",
  "attachment.download": "تنزيل {name}",
  "attachment.downloadProgress": "{received} من {total}",
  "attachment.stopDownload": "إيقاف تنزيل {name}، {percent}%",
  "attachment.downloadFailed": "فشل التنزيل",
  "attachment.retryDownload": "إعادة محاولة تنزيل {name}",
  "attachment.open": "فتح {name}",
  "attachment.loadMedia": "تشغيل {name}",
  "attachment.previewUnavailable": "المعاينة غير متاحة.",
  "attachment.error.preview": "تعذّرت معاينة {name}. حاول مرة أخرى.",
  "attachment.error.download": "تعذّر تنزيل المرفقات. حاول مرة أخرى.",
  "attachment.error.open": "تعذّر فتح هذا المرفق أو حفظه. حاول مرة أخرى.",
  "attachment.error.openFile": "تعذّر فتح هذا الملف. حاول مرة أخرى.",
  "attachment.error.fileFallback": "ملف",
  "attachment.error.fileNotFound": "لم يتم العثور على «{name}» في هذا المسار. ربما تم نقله أو حذفه.",
  "attachment.error.previewFile": "تعذّرت معاينة «{name}». حاول مرة أخرى.",
} as const satisfies PartialTranslation<typeof source>;
