import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "بازکردن فایل",
  "attachment.preview": "پیش‌نمایش {name}",
  "attachment.notFound": "فایل پیدا نشد",
  "attachment.download": "بارگیری {name}",
  "attachment.downloadProgress": "{received} از {total}",
  "attachment.stopDownload": "توقف بارگیری {name}، {percent}%",
  "attachment.downloadFailed": "بارگیری ناموفق بود",
  "attachment.retryDownload": "تلاش دوباره برای بارگیری {name}",
  "attachment.open": "بازکردن {name}",
  "attachment.loadMedia": "پخش {name}",
  "attachment.previewUnavailable": "پیش‌نمایش در دسترس نیست.",
  "attachment.error.preview": "پیش‌نمایش {name} ممکن نشد. دوباره تلاش کنید.",
  "attachment.error.download": "بارگیری پیوست‌ها ممکن نشد. دوباره تلاش کنید.",
  "attachment.error.open": "بازکردن یا ذخیرهٔ این پیوست ممکن نشد. دوباره تلاش کنید.",
  "attachment.error.openFile": "بازکردن این فایل ممکن نشد. دوباره تلاش کنید.",
  "attachment.error.fileFallback": "فایل",
  "attachment.error.fileNotFound": "«{name}» در این مسیر پیدا نشد. شاید جابه‌جا یا حذف شده باشد.",
  "attachment.error.previewFile": "پیش‌نمایش «{name}» ممکن نشد. دوباره تلاش کنید.",
} as const satisfies PartialTranslation<typeof source>;
