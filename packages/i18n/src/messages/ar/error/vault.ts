import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "لا يحتوي هذا الحاسوب على مخزن للأسرار، لذا لا يمكن للخزنة حفظ العناصر.",
  "error.vault.unreadable": "ملف الخزنة غير قابل للقراءة. أعد تعيين الخزنة لاستخدامها مرة أخرى.",
  "error.vault.tooLarge": "الخزنة ممتلئة. احذف بعض العناصر، ثم حاول مرة أخرى.",
  "error.vault.itemMissing": "لم يعد هذا العنصر في الخزنة.",
  "error.vault.valueTooLong": "إحدى القيم طويلة جدًا.",
  "error.vault.websiteInvalid": "أدخل عنوان موقع ويب يبدأ بـ HTTPS.",
  "error.vault.passwordRequired": "أدخل كلمة مرور.",
  "error.vault.cardNumberInvalid": "أدخل رقم بطاقة صالحًا.",
  "error.vault.securityCodeInvalid": "أدخل رمز أمان من 3 أو 4 أرقام.",
  "error.vault.expiryInvalid": "أدخل شهر وسنة انتهاء صالحين.",
  "error.vault.contactEmpty": "أدخل اسمًا أو عنوانًا أو رقم هاتف أو عنوان بريد إلكتروني.",
  "error.vault.contactMissing": "لم تعد جهة اتصال الفوترة في الخزنة.",
  "error.vault.apiKeyRequired": "أدخل مفتاح API.",
  "error.vault.apiKeyNameInvalid":
    "أدخل اسم متغير يتكون من الأحرف الكبيرة A–Z والأرقام و_، ويبدأ بحرف، مثل OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "تحتوي الخزنة بالفعل على مفتاح API باسم المتغير هذا.",
  "error.vault.csvInvalid": "هذا الملف ليس تصدير كلمات مرور بتنسيق CSV.",
  "error.vault.csvTooLarge": "ملف CSV كبير جدًا.",
} as const satisfies PartialTranslation<typeof source>;
