import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot شروع نشد",
  "startup.failedBody": "{message}\n\nداده‌های محلی شما بازنشانی یا بازنویسی نشدند. برای بازیابی، راهنمای عیب‌یابی را ببینید.",
  "startup.archiveChangedTitle": "فایل‌های OpenBot تغییر کرده‌اند",
  "startup.archiveChangedBody": "برنامه‌ای دیگر فایل OpenBot یعنی app.asar را تغییر داده است. OpenBot اکنون اجرا می‌شود، اما پس از خروج دوباره باز نخواهد شد.\n\nبرای تعمیر OpenBot، آن را دوباره نصب کنید. داده‌های محلی شما باقی می‌مانند.",
  "startup.archiveChangedDownload": "بارگیری OpenBot",
  "startup.newerDataUpdatingTitle": "در حال به‌روزرسانی OpenBot",
  "startup.newerDataUpdatingBody": "نسخهٔ جدیدتری از OpenBot داده‌های شما را ذخیره کرده است. OpenBot آخرین نسخه را نصب می‌کند و دوباره باز می‌شود.\n\nداده‌های محلی شما بازنشانی یا بازنویسی نشدند.",
  "startup.newerDataTitle": "آخرین نسخهٔ OpenBot را نصب کنید",
  "startup.newerDataBody": "نسخهٔ جدیدتری از OpenBot داده‌های شما را ذخیره کرده است و این نسخه ({version}) نمی‌تواند آن‌ها را باز کند. برای دسترسی به داده‌ها، آخرین نسخه را نصب کنید.\n\nداده‌های محلی شما بازنشانی یا بازنویسی نشدند.",
  "startup.newerDataDownload": "بارگیری OpenBot",
  "startup.newerDataGuide": "باز کردن راهنما",
  "startup.newerDataQuit": "خروج",
} as const satisfies PartialTranslation<typeof source>;
