import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "قائمة انتظار الرسائل",
  "queue.moved": "نُقلت الرسالة المنتظرة إلى الموضع {position} من {total}.",
  "queue.attachment": "مرفق",
  "queue.hold.named": "في الانتظار - {name} يعمل في {channel}",
  "queue.hold.unnamed": "في الانتظار - هذا الوكيل يعمل في {channel}",
  "queue.item.label": "الرسالة المنتظرة {position}: {preview}",
  "queue.item.labelEditing": "الرسالة المنتظرة {position}، قيد التعديل: {preview}",
  "queue.item.editing": "قيد التعديل",
  "queue.item.steerLabel": "توجيه الرسالة المنتظرة {position}",
  "queue.item.steerTooltip": "توجيه الرسالة",
  "queue.item.steering": "جارٍ التوجيه",
  "queue.item.steer": "توجيه",
  "queue.item.sendNowLabel": "أوقف الوكيل وأرسل الرسالة {position} من قائمة الانتظار الآن",
  "queue.item.sendNowTooltip": "أوقف الوكيل وأرسل هذه الرسالة الآن",
  "queue.item.sendNow": "أرسل الآن",
  "queue.item.notSteered": "لم يتم التوجيه",
  "queue.item.steerFallback.providerUnsupported":
    "لا يستطيع هذا المزوّد توجيه دور قيد التشغيل، لذا تنتظر الرسالة في قائمة الانتظار.",
  "queue.item.steerFallback.steerFailed": "لم ينجح التوجيه، لذا تنتظر الرسالة في قائمة الانتظار.",
  "queue.item.runAsTask": "تشغيل في سلسلة جديدة",
  "queue.item.runAsTaskLabel": "تشغيل الرسالة المنتظرة {position} في سلسلة جديدة",
  "queue.item.deleteLabel": "حذف الرسالة المنتظرة {position}",
  "queue.item.deleteTooltip": "حذف الرسالة",
  "queue.item.editLabel": "تعديل الرسالة المنتظرة {position}",
  "queue.item.editTooltip": "تعديل الرسالة",
  "queue.deleteHeld.title": "هل تريد حذف الرسالة المنتظرة؟",
  "queue.deleteHeld.body": "يعدّل جهاز آخر هذه الرسالة. لن يتلقاها الوكيل.",
  "queue.deleteHeld.keep": "إبقاء",
} as const satisfies PartialTranslation<typeof source>;
