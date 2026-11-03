import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "لم يُعثر على المرفق.",
  "error.attachment.fileTooLarge": "يتجاوز أحد الملفات الحد البالغ 100 MB.",
  "error.attachment.totalTooLarge": "تتجاوز المرفقات الحد الإجمالي البالغ 250 MB.",
  "error.attachment.unavailable": "لم يعد هذا الملف متاحًا.",
  "error.attachment.tooMany": "اختر {limit} ملفات على الأكثر.",
  "error.attachment.mediaUnsupported": "لا يدعم هذا الخادم مرفقات MP3 أو MOV. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.emlUnsupported": "لا يدعم هذا الخادم مرفقات EML. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.zipUnsupported": "لا يدعم هذا الخادم مرفقات ZIP. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.mp4Unsupported": "لا يدعم هذا الخادم مرفقات MP4. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.svgUnsupported": "لا يدعم هذا الخادم مرفقات SVG. حدّث OpenBot على المضيف وأعد المحاولة.",
  "error.attachment.previewTooLarge": "يتجاوز الملف الحد البالغ 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
