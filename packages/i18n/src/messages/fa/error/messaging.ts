import { defineMessages } from "../../../message";

export const messages = defineMessages("error.messaging", {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "این فضای کاری Slack وصل نیست.",
  "error.messaging.unsupported": "این رایانه نمی‌تواند به Slack وصل شود.",
  "error.messaging.relayUnavailable": "OpenBot نمی‌تواند رویدادهای Slack را در این رایانه دریافت کند. وارد شوید، برای این رایانه نامی بگذارید و دوباره تلاش کنید.",
  // Errors of a Discord server connection, which the host sends.
  "error.messaging.discordNotConnected": "این سرور Discord وصل نیست.",
  "error.messaging.discordUnsupported": "این رایانه نمی‌تواند به Discord وصل شود.",
  "error.messaging.discordRelayUnavailable": "OpenBot نمی‌تواند رویدادهای Discord را در این رایانه دریافت کند. وارد شوید، برای این رایانه نامی بگذارید و دوباره تلاش کنید.",
  "error.messaging.discordRolesUnsupported": "OpenBot هنوز نمی‌تواند نقش‌های Discord را فهرست کند. بعداً دوباره تلاش کنید.",
  // Errors of a Telegram chat connection, which the host sends.
  "error.messaging.telegramNotConnected": "این گفت‌وگوی Telegram وصل نیست.",
  "error.messaging.telegramUnsupported": "این رایانه نمی‌تواند به Telegram وصل شود.",
  "error.messaging.telegramRelayUnavailable": "OpenBot نمی‌تواند از این رایانه به Telegram دسترسی پیدا کند. وارد شوید، برای این رایانه نامی بگذارید و دوباره تلاش کنید.",
  "error.messaging.telegramServiceUnavailable": "OpenBot اکنون نمی‌تواند به Telegram وصل شود. بعداً دوباره تلاش کنید.",
  // Errors of a linked WhatsApp number, which the host sends.
  "error.messaging.whatsappNotConnected": "این شمارهٔ WhatsApp وصل نیست.",
  "error.messaging.whatsappUnsupported": "این رایانه نمی‌تواند به WhatsApp وصل شود.",
  "error.messaging.whatsappTooManySenders": "یک شمارهٔ WhatsApp می‌تواند حداکثر 200 مخاطب و گروه را مجاز کند.",
  "error.messaging.whatsappRequestEnded": "این درخواست پایان یافت. از فرد بخواهید دوباره پیام بدهد تا کد تازه‌ای بگیرد.",
  // The agent gets this when a connected workspace has too many saved facts.
  "error.messaging.memoryLimit": "فضای کاری متصل می‌تواند حداکثر {limit} حافظه داشته باشد. ابتدا یکی را حذف کنید.",
});
