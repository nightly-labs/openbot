import { defineMessages } from "../../../message";

export const messages = defineMessages("error.host", {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal سرورهای ICE را ارائه نکرده است.",
  "error.host.keyRotationUnavailable": "این سرور بدون سرویس حساب نمی‌تواند کلیدش را تغییر دهد.",
  "error.host.keyRotationRefused": "سرویس حساب کلید تازهٔ سرور را نپذیرفت. کلید فعلی همچنان استفاده می‌شود.",
  "error.host.webRtcNotConfigured": "سرویس میزبان WebRTC پیکربندی نشده است.",
  "error.host.runtimeNotInstalled": "زمان اجرای دسکتاپ از راه دور نصب نشده است.",
  "error.host.setupUnavailable": "راه‌اندازی مجوزها در دسترس نیست.",
  "error.host.accountChangedDuringUpdate": "هنگام به‌روزرسانی این سرور، حساب واردشده تغییر کرد.",
  "error.host.nameBeforePublish": "پیش از انتشار، نامی برای این OpenBot بگذارید.",
  "error.host.memberNotFound": "این عضو از راه دور وجود ندارد.",
  "error.host.publishBeforeInvite": "پیش از ساخت دعوت‌نامه، این OpenBot را عمومی کنید.",
  "error.host.teamAccessUnavailable": "دسترسی تیم شما در دسترس نیست.",
  "error.host.ownerIdentityUnavailable": "هویت مالک میزبان در دسترس نیست.",
  "error.host.reserveAddressFailed": "رزرو نشانی عمومی ناموفق بود.",
  "error.host.publishFailed": "انتشار این OpenBot ناموفق بود.",
  "error.host.mobileConnectPublishFailed": "انتشار این OpenBot برای Mobile Connect ناموفق بود.",
  "error.host.mobileConnectHostChanged": "میزبان Mobile Connect تغییر کرد. دوباره تلاش کنید.",
  "error.host.noServer": "این رایانه سروری ندارد که بتوان آن را تغییر داد.",
  "error.host.identityLocalOnly": "نام و نشان‌وارهٔ سرور را فقط در رایانه‌ای می‌توان تغییر داد که آن را اجرا می‌کند.",
  "error.host.timezoneInvalid": "این منطقهٔ زمانی شناخته‌شده نیست.",
  "error.host.maintenanceInterrupted": "نگه‌داری میزبان ناتمام ماند. پیش از تلاش دوباره، برنامه را بررسی و وضعیت میزبان را بازنشانی کنید.",
  "error.host.updateFailed": "به‌روزرسانی میزبان هنگام {phase} ناموفق بود. پیش از بازنشانی وضعیت، مالکیت بسته، امضا، وضعیت مستأجر و فضای آزاد دیسک را بررسی کنید.",
  "error.host.tenantsNotIdle": "مستأجرها در بازهٔ دو ساعت، پنج دقیقه بی‌کار نماندند.",
  "error.host.tenantShutdownTimeout": "مهلت خاموش‌شدن مستأجر به پایان رسید. جایگزینی برنامه شروع نشد.",
  "error.host.tenantHealthMissing": "پس از راه‌اندازی دوباره، گزارش‌های سلامت مستأجر موجود نیستند یا وضعیت سالمی ندارند. پیش از به‌روزرسانی دوباره، نشست‌های مستأجر را بررسی کنید.",
});
