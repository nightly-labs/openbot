import { defineMessages } from "../../../message";

export const messages = defineMessages("error.update", {
  // Updater state the user reads.
  "error.update.unsupported": "به‌روزرسانی‌ها در نسخه‌های دسکتاپ نصب‌شده در دسترس‌اند.",
  "error.update.notReady": "به‌روزرسانی برای نصب آماده نیست.",
  "error.update.restartFailed": "OpenBot نتوانست برای نصب به‌روزرسانی دوباره راه‌اندازی شود.",
  "error.update.downloadStalled": "بارگیری به‌روزرسانی دیگر پاسخ نمی‌دهد. دوباره تلاش کنید.",
  "error.update.installFailed": "نصب به‌روزرسانی ناموفق بود. از OpenBot خارج شوید، آن را دوباره باز کنید و تلاش کنید.",
  "error.update.downloadFailed": "بارگیری به‌روزرسانی ناموفق بود. دوباره تلاش کنید.",
  "error.update.checkFailed": "بررسی به‌روزرسانی‌ها ناموفق بود. دوباره تلاش کنید.",
  "error.update.checkStalled": "بررسی به‌روزرسانی دیگر پاسخ نمی‌دهد. دوباره تلاش کنید.",
  "error.update.checkOffline": "دسترسی به سرویس به‌روزرسانی ممکن نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.",
  "error.update.checkUnavailable": "سرویس به‌روزرسانی پاسخ نداد. OpenBot چند دقیقهٔ دیگر خودکار دوباره تلاش می‌کند.",
  "error.update.checkNoRelease": "برای این سکو به‌روزرسانی منتشرشده‌ای پیدا نشد. OpenBot چند دقیقهٔ دیگر خودکار دوباره تلاش می‌کند.",
  "error.update.managedByNix": "Nix به‌روزرسانی‌های این نسخهٔ OpenBot را نصب می‌کند. آن را با Nix به‌روز کنید.",
  "error.update.managedByHost": "به‌روزرسانی‌های این Mac را میزبان نصب می‌کند. به‌روزرسانی تا اجرای کار نگه‌داری میزبان آماده می‌ماند.",
  "error.update.siblingSession": "هنوز نشست دیگری از OpenBot با این برنامه در حال اجراست. ابتدا OpenBot را در همهٔ حساب‌های کاربری دیگر macOS متوقف کنید و سپس دوباره به‌روزرسانی را نصب کنید.",
  "error.update.siblingSessionSameAccount": "هنوز پردازهٔ دیگری از OpenBot در این حساب کاربری در حال اجراست. از آن خارج شوید و سپس دوباره به‌روزرسانی را نصب کنید.",
  "error.update.siblingCheckFailed": "بررسی نشست‌های دیگر OpenBot ممکن نشد. پیش از نصب دوباره تلاش کنید.",
  // A joined server's admin reads these from the host.
  "error.update.remoteDisabled": "به‌روزرسانی از سوی مدیران سرور در این رایانه خاموش است.",
  "error.update.restartStarted": "OpenBot برای نصب به‌روزرسانی در حال راه‌اندازی دوباره است.",
  "error.update.alreadyRestarting": "OpenBot همین حالا هم در حال راه‌اندازی دوباره است.",
});
