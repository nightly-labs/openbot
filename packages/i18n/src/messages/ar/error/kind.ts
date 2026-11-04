import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "تعذّر الاتصال. تحقق من اتصالك وأعد المحاولة.",
  "error.kind.timeout": "استغرق الطلب وقتًا طويلًا. تحقق مما إذا اكتمل الإجراء قبل أن تعيد المحاولة.",
  "error.kind.storage": "لا توجد مساحة تخزين كافية. أفرغ بعض المساحة على الحاسوب الذي يشغّل OpenBot، ثم أعد المحاولة.",
  "error.kind.filePermission":
    "ليس لدى OpenBot إذن لإكمال هذا الإجراء. تحقق من أذونات الملف أو المجلد، ثم أعد المحاولة.",
  "error.kind.notFound": "تعذّر العثور على ملف أو مجلد مطلوب. استعده أو اختر غيره، ثم أعد المحاولة.",
  "error.kind.readOnly": "هذا المجلد للقراءة فقط. اختر مجلدًا يمكنك الكتابة فيه، ثم أعد المحاولة.",
  "error.kind.conflict": "يوجد عنصر بهذا الاسم بالفعل. اختر اسمًا مختلفًا، ثم أعد المحاولة.",
  "error.kind.auth": "أخفقت المصادقة. تحقق من حسابك أو من الاتصال بالخادم، ثم أعد المحاولة.",
  "error.kind.permission": "ليس لديك إذن لإكمال هذا الإجراء. اطلب الوصول من المالك.",
  "error.kind.rateLimit": "طلبات كثيرة جدًا. انتظر قليلًا، ثم أعد المحاولة.",
  "error.kind.service": "الخدمة غير متاحة. انتظر قليلًا، ثم أعد المحاولة.",
} as const satisfies PartialTranslation<typeof source>;
