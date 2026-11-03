import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "تعذّر على OpenBot الوصول إلى خدمة الحساب. تحقّق من أن الواجهة البرمجية API تعمل، ثم أعد المحاولة.",
  "error.auth.networkBlocked":
    "منع جدار حماية أو وكيل شبكة في هذه الشبكة OpenBot من الوصول إلى {host}. اطلب من مسؤول الشبكة السماح بـ {host}، ثم أعد المحاولة.",
  "error.auth.signInFirst": "سجّل الدخول إلى OpenBot أولًا.",
  "error.auth.signInRequired": "تسجيل الدخول مطلوب.",
  "error.auth.accountChangedDuringRegister": "تغيّر الحساب المسجّل الدخول أثناء تسجيل هذا الخادم.",
  "error.auth.hostCredentialUnavailable": "بيانات اعتماد المضيف البعيد غير متاحة. سجّل المضيف مرة أخرى.",
  "error.auth.codeNotVerified": "تعذّر التحقق من رمز تسجيل الدخول.",
  "error.auth.serviceError": "أعادت خدمة الحساب خطأً.",
  "error.auth.serviceUnreachable": "تعذّر على OpenBot الوصول إلى خدمة الحساب. تحقّق من اتصالك، ثم أعد المحاولة.",
  "error.auth.serviceTimeout": "لم تستجب خدمة الحساب في الوقت المحدد. أعد المحاولة.",
  "error.auth.serviceStatus": "أعادت خدمة الحساب خطأً ({status}). أعد المحاولة لاحقًا.",
  "error.auth.invalidHostedServer": "أعادت خدمة الحساب خادمًا مستضافًا غير صالح.",
  "error.auth.codeNotSent": "تعذّر على OpenBot إرسال رمز تسجيل الدخول.",
  "error.auth.deliveryTimeout":
    "تعذّر على OpenBot تأكيد التسليم في الوقت المحدد. قد يصل الرمز رغم ذلك؛ تحقّق من التسليم قبل الإرسال مرة أخرى.",
  "error.auth.deliveryInterrupted": "انقطع الاتصال قبل أن يؤكد OpenBot التسليم. تحقّق من التسليم لتجنّب إرسال رمز آخر.",
  "error.auth.deliveryUnknown": "تعذّر على OpenBot تأكيد إرسال رمز تسجيل الدخول. تحقّق من التسليم قبل الإرسال مرة أخرى.",
} as const satisfies PartialTranslation<typeof source>;
