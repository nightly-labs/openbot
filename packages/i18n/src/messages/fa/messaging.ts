import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token": "Slack دیگر OpenBot را در این فضای کاری نمی‌پذیرد. شاید برنامه حذف شده باشد. دوباره به فضای کاری وصل شوید.",
  "messaging.help.secret_storage_unavailable": "OpenBot نمی‌تواند نشانه‌های ذخیره‌شده در این رایانه را بخواند. اتصال فضای کاری را قطع و سپس دوباره وصل کنید.",
  "messaging.help.relay_unavailable": "OpenBot نمی‌تواند رویدادهای Slack را در این رایانه دریافت کند. وارد شوید، در تنظیمات سرور برای این رایانه نامی بگذارید و OpenBot را باز نگه دارید.",
  "messaging.discordHelp.invalid_token": "Discord دیگر OpenBot را در این سرور Discord نمی‌پذیرد. شاید برنامه برداشته شده باشد. دوباره به سرور Discord وصل شوید.",
  "messaging.discordHelp.secret_storage_unavailable": "OpenBot نمی‌تواند نشانه‌های ذخیره‌شده در این رایانه را بخواند. اتصال سرور Discord را قطع و سپس دوباره وصل کنید.",
  "messaging.discordHelp.relay_unavailable": "OpenBot نمی‌تواند رویدادهای Discord را در این رایانه دریافت کند. وارد شوید، در تنظیمات سرور برای این رایانه نامی بگذارید و OpenBot را باز نگه دارید.",
} as const satisfies PartialTranslation<typeof source>;
