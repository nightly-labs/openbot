import { defineMessages } from "../../../message";

export const messages = defineMessages("error.app", {
  // Errors from app, notification, and secret storage actions.
  "error.app.externalLinkProtocol": "فقط پیوندهای HTTP(S) را می‌توان در مرورگر بیرونی باز کرد.",
  "error.app.notificationsUnsupported": "این سیستم از اعلان‌های دسکتاپ پشتیبانی نمی‌کند.",
  "error.app.notificationSettingsMissing": "این سیستم صفحهٔ تنظیمات اعلان ندارد.",
  "error.app.notReady": "OpenBot آماده نیست.",
  "error.app.macSecureStorageUnavailable": "ذخیره‌سازی امن در macOS در دسترس نیست.",
  "error.app.secretStorageUnavailable": "ذخیره‌سازی امن سیستم در دسترس نیست.",
  "error.app.remoteIdentityUnavailable": "هویت میزبان از راه دور در دسترس نیست.",
  "error.app.iceServersMissing": "Remote Signal هنوز سرورهای ICE را ارائه نکرده است.",
  "error.app.finishLocalTest": "پیش از جابه‌جایی نمایشگرها، آزمون محلی را تمام کنید.",
});
