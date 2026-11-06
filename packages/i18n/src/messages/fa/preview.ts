import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "پیش‌نمایش فایل",
  "preview.panel.resize": "تغییر اندازهٔ پیش‌نمایش فایل",
  "preview.panel.copy": "کپی متن فایل",
  "preview.panel.openExternally": "باز کردن فایل در برنامه‌ای دیگر",
  "preview.panel.download": "بارگیری فایل",
  "preview.panel.reveal": "نمایش فایل در Finder",
  "preview.panel.close": "بستن پیش‌نمایش فایل",
  "preview.panel.back": "بازگشت",
  "preview.panel.rawMarkdown": "نمایش متن Markdown",
  "preview.panel.rawHtml": "نمایش متن HTML",
  "preview.panel.wrapLines": "شکستن خط‌های بلند",
  "preview.folder.empty": "این پوشه خالی است.",
  "preview.folder.truncated": "فقط {limit} مورد اول نمایش داده می‌شود.",
  "preview.truncated": "پیش‌نمایش پس از {limit} نویسه کوتاه شده است.",
  "preview.unavailable": "پیش‌نمایش در دسترس نیست.",
  "preview.unsupported.title": "پیش‌نمایش در دسترس نیست",
  "preview.unsupported.description": "این فایل را می‌توان با برنامهٔ پیش‌فرض باز کرد.",
  "preview.unsupported.openExternally": "باز کردن در برنامه‌ای دیگر",
  "preview.spreadsheet.readFailed": "خواندن این صفحه‌گسترده ممکن نشد.",
  "preview.spreadsheet.truncated": "پیش‌نمایش به {rows} ردیف و {columns} ستون اول محدود است.",
} as const satisfies PartialTranslation<typeof source>;
