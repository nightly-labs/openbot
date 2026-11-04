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
  "error.auth.companySignInFailed": "لم يكتمل تسجيل الدخول بحساب الشركة. حاول مرة أخرى.",
  "error.auth.companySignInCancelled": "أُلغي تسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInTimeout": "استغرق تسجيل الدخول بحساب الشركة وقتًا طويلًا. افتح صفحة تسجيل الدخول مرة أخرى.",
  "error.auth.companySignInRefused": "أُلغي تسجيل الدخول في شركتك أو رُفض.",
  "error.auth.companySignInDomainMismatch": "بريد حساب الشركة في نطاق غير موجود في الإعداد.",
  "error.auth.companySignInAccountDisabled": "أوقفت شركتك هذا الحساب. اسأل المسؤول.",
  "error.auth.companySignInOff": "تسجيل الدخول بحساب الشركة متوقف لهذا البريد الإلكتروني.",
  "error.auth.companySignInEmailMissing": "لم يعطِ حساب شركتك عنوان بريد إلكتروني موثّقًا.",
  "error.auth.companySignInUnavailable": "لا يستطيع OpenBot هذا فتح متصفح لتسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInProviderRejected": "لم يقبل المزوّد معرّف العميل أو السر.",
  "error.auth.companySignInTokenInvalid": "أعطى المزوّد تسجيل دخول لا يستطيع OpenBot التحقق منه.",
  "error.auth.companySignInProviderUnreachable": "لم يردّ مزوّد تسجيل الدخول بحساب الشركة.",
  "error.auth.companySignInDomainTaken": "أحد هذه النطاقات يسجّل الدخول من خلال خادم آخر.",
  "error.auth.companySignInNoServer": "شغّل هذا الخادم قبل أن تُعدّ تسجيل الدخول بحساب الشركة.",
} as const satisfies PartialTranslation<typeof source>;
