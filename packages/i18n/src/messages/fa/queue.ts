import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "صف پیام‌ها",
  "queue.moved": "پیام صف‌شده به جایگاه {position} از {total} منتقل شد.",
  "queue.attachment": "پیوست",
  "queue.hold.named": "در انتظار؛ {name} در {channel} کار می‌کند",
  "queue.hold.unnamed": "در انتظار؛ این عامل در {channel} کار می‌کند",
  "queue.item.label": "پیام صف‌شدهٔ {position}: {preview}",
  "queue.item.labelEditing": "پیام صف‌شدهٔ {position}، در حال ویرایش: {preview}",
  "queue.item.editing": "در حال ویرایش",
  "queue.item.steerLabel": "هدایت پیام صف‌شدهٔ {position}",
  "queue.item.steerTooltip": "هدایت پیام",
  "queue.item.steering": "در حال هدایت",
  "queue.item.steer": "هدایت",
  "queue.item.notSteered": "هدایت‌نشده",
  "queue.item.steerFallback.providerUnsupported":
    "این ارائه‌دهنده نمی‌تواند نوبت در حال اجرا را هدایت کند؛ پیام در صف می‌ماند.",
  "queue.item.steerFallback.steerFailed": "هدایت انجام نشد؛ پیام در صف می‌ماند.",
  "queue.item.runAsTask": "اجرا در گفت‌وگوی تازه",
  "queue.item.runAsTaskLabel": "اجرای پیام صف‌شدهٔ {position} در گفت‌وگوی تازه",
  "queue.item.deleteLabel": "حذف پیام صف‌شدهٔ {position}",
  "queue.item.deleteTooltip": "حذف پیام",
  "queue.item.editLabel": "ویرایش پیام صف‌شدهٔ {position}",
  "queue.item.editTooltip": "ویرایش پیام",
  "queue.deleteHeld.title": "پیام صف‌شده حذف شود؟",
  "queue.deleteHeld.body": "دستگاهی دیگر در حال ویرایش این پیام است. عامل آن را دریافت نخواهد کرد.",
  "queue.deleteHeld.keep": "نگه‌داشتن",
} as const satisfies PartialTranslation<typeof source>;
