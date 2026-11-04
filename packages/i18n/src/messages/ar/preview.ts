import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "معاينة الملف",
  "preview.panel.resize": "تغيير حجم معاينة الملف",
  "preview.panel.copy": "نسخ نص الملف",
  "preview.panel.openExternally": "فتح الملف خارجيًا",
  "preview.panel.download": "تنزيل الملف",
  "preview.panel.reveal": "إظهار الملف في Finder",
  "preview.panel.close": "إغلاق معاينة الملف",
  "preview.panel.back": "رجوع",
  "preview.panel.rawMarkdown": "إظهار مصدر Markdown",
  "preview.panel.rawHtml": "إظهار مصدر HTML",
  "preview.panel.wrapLines": "التفاف الأسطر الطويلة",
  "preview.folder.empty": "هذا المجلد فارغ.",
  "preview.folder.truncated": "تظهر أول {limit} عناصر فقط.",
  "preview.truncated": "اقتُطعت المعاينة بعد {limit} حرف.",
  "preview.unavailable": "المعاينة غير متاحة.",
  "preview.unsupported.title": "المعاينة غير متاحة",
  "preview.unsupported.description": "يمكن فتح هذا النوع من الملفات في تطبيقه الافتراضي.",
  "preview.unsupported.openExternally": "فتح خارجيًا",
  "preview.spreadsheet.readFailed": "تعذّرت قراءة جدول البيانات هذا.",
  "preview.spreadsheet.truncated": "المعاينة مقتصرة على أول {rows} صفوف و{columns} أعمدة.",
} as const satisfies PartialTranslation<typeof source>;
