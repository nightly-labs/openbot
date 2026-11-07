import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "برای اشتراک‌گذاری وارد شوید",
  "mobile.share.signInDescription":
    "کد QR را در OpenBot روی رایانه‌تان اسکن کنید. سپس می‌توانید عاملی را انتخاب کنید که محتوای اشتراک‌گذاشته‌شده به آن می‌رسد.",
  "mobile.share.reading": "در حال خواندن محتوای اشتراک‌گذاشته‌شده…",
  "mobile.share.readFailed": "OpenBot نتوانست محتوای اشتراک‌گذاشته‌شده را بخواند. دوباره آن را به‌اشتراک بگذارید.",
  "mobile.share.content": "برای اشتراک‌گذاری",
  "mobile.share.footer": "این محتوا در کادر پیام گفت‌وگو قرار می‌گیرد. تا وقتی آن را ارسال نکنید، چیزی فرستاده نمی‌شود.",
  "mobile.share.lastUsed": "آخرین‌بار استفاده‌شده",
  "mobile.share.noAgents": "عاملی نیست",
  "mobile.share.chooseAgent": "عاملی را انتخاب کنید",
  "mobile.share.action": "اشتراک‌گذاری با {name}",
  "mobile.share.extension.send": "ارسال",
  "mobile.share.extension.footer": "OpenBot این محتوا را همین حالا برای عامل می‌فرستد. برنامه باز نمی‌شود.",
  "mobile.share.extension.sending": "در حال ارسال به {name}…",
  "mobile.share.extension.sent": "برای {name} ارسال شد",
  "mobile.share.extension.failed": "OpenBot نتوانست این محتوا را بفرستد. برای ارسال، برنامه را باز کنید.",
  "mobile.share.extension.unconfirmed": "سرور دریافت پیام را تأیید نکرد. پیش از ارسال دوباره، گفت‌وگو را بررسی کنید.",
  "mobile.share.extension.openApp": "باز کردن OpenBot",
} as const satisfies PartialTranslation<typeof source>;
