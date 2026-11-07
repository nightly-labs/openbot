import { defineMessages } from "../../../message";

/** The sentence for each kind `classifyUserError` decides. `@openbot/user-errors` owns the mapping. */
export const messages = defineMessages("error.kind", {
  "error.kind.network": "اتصال برقرار نشد. اتصال خود را بررسی و دوباره تلاش کنید.",
  "error.kind.timeout": "درخواست بیش از حد طول کشید. پیش از تلاش دوباره بررسی کنید که کار انجام شده است یا نه.",
  "error.kind.storage": "فضای ذخیره‌سازی کافی نیست. در رایانه‌ای که OpenBot روی آن اجرا می‌شود کمی فضا خالی کنید و دوباره تلاش کنید.",
  "error.kind.filePermission": "OpenBot اجازهٔ انجام این کار را ندارد. مجوزهای فایل یا پوشه را بررسی و دوباره تلاش کنید.",
  "error.kind.notFound": "فایل یا پوشهٔ لازم پیدا نشد. آن را بازیابی کنید یا مورد دیگری انتخاب و دوباره تلاش کنید.",
  "error.kind.readOnly": "این پوشه فقط‌خواندنی است. پوشه‌ای را انتخاب کنید که بتوانید در آن بنویسید و دوباره تلاش کنید.",
  "error.kind.conflict": "موردی با این نام از قبل وجود دارد. نام دیگری انتخاب کنید و دوباره تلاش کنید.",
  "error.kind.auth": "احراز هویت ناموفق بود. حساب یا اتصال به سرور را بررسی و دوباره تلاش کنید.",
  "error.kind.permission": "اجازهٔ انجام این کار را ندارید. از مالک دسترسی بخواهید.",
  "error.kind.rateLimit": "درخواست‌ها بیش از حد زیاد است. کمی صبر کنید و دوباره تلاش کنید.",
  "error.kind.service": "سرویس در دسترس نیست. کمی صبر کنید و دوباره تلاش کنید.",
});
