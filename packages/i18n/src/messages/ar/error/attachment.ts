import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "لم يُعثر على المرفق.",
  "error.attachment.fileTooLarge": "يتجاوز أحد الملفات الحد البالغ 100 MB.",
  "error.attachment.namedFileTooLarge": "{name} أكبر من الحد البالغ 100 MB.",
  "error.attachment.emptyFile":
    "الملف {name} فارغ أو لا يستطيع OpenBot قراءته. احفظ الملف مرة أخرى، ثم أرفقه مرة أخرى.",
  "error.attachment.totalTooLarge": "تتجاوز المرفقات الحد الإجمالي البالغ 250 MB.",
  "error.attachment.unavailable": "لم يعد هذا الملف متاحًا.",
  "error.attachment.noApp": "لم يفتح أي تطبيق على هذا الكمبيوتر هذا الملف. نزّله، ثم افتحه من مدير الملفات.",
  "error.attachment.tooMany": "اختر {limit} ملفات على الأكثر.",
  "error.attachment.mediaUnsupported": "لا يدعم هذا الخادم مرفقات MP3 أو MOV. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.emlUnsupported": "لا يدعم هذا الخادم مرفقات EML. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.zipUnsupported": "لا يدعم هذا الخادم مرفقات ZIP. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.mp4Unsupported": "لا يدعم هذا الخادم مرفقات MP4. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.svgUnsupported": "لا يدعم هذا الخادم مرفقات SVG. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.previewTooLarge": "يتجاوز الملف الحد البالغ 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
