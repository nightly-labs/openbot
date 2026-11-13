import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "لم يوفّر Remote Signal خوادم ICE.",
  "error.host.keyRotationUnavailable": "لا يمكن لهذا الخادم تغيير مفتاحه بدون خدمة الحساب.",
  "error.host.keyRotationRefused": "لم تقبل خدمة الحساب مفتاح الخادم الجديد. يبقى المفتاح الحالي قيد الاستخدام.",
  "error.host.webRtcNotConfigured": "خدمة مضيف WebRTC غير مهيّأة.",
  "error.host.runtimeNotInstalled": "بيئة تشغيل سطح المكتب البعيد غير مثبّتة.",
  "error.host.setupUnavailable": "إعداد الأذونات غير متاح.",
  "error.host.accountChangedDuringUpdate": "تغيّر الحساب المسجّل الدخول أثناء تحديث هذا الخادم.",
  "error.host.nameBeforePublish": "سمِّ OpenBot هذا قبل نشره.",
  "error.host.memberNotFound": "العضو البعيد غير موجود.",
  "error.host.publishBeforeInvite": "اجعل OpenBot هذا عامًا قبل إنشاء دعوة.",
  "error.host.teamAccessUnavailable": "وصولك إلى الفريق غير متاح.",
  "error.host.ownerIdentityUnavailable": "هوية مالك المضيف غير متاحة.",
  "error.host.reserveAddressFailed": "تعذّر حجز العنوان العام.",
  "error.host.publishFailed": "تعذّر نشر OpenBot هذا.",
  "error.host.mobileConnectPublishFailed": "تعذّر نشر OpenBot هذا لـ Mobile Connect.",
  "error.host.mobileConnectHostChanged": "تغيّر مضيف Mobile Connect. حاول مرة أخرى.",
  "error.host.noServer": "لا يوجد على هذا الحاسوب خادم لتغييره.",
  "error.host.identityLocalOnly": "لا يمكن تغيير اسم الخادم وشعاره إلا على الحاسوب الذي يشغّله.",
  "error.host.timezoneInvalid": "هذه المنطقة الزمنية غير معروفة.",
  "error.host.turnLimitInvalid": "هذا الحد للخيوط غير صالح.",
  "error.host.maintenanceInterrupted": "توقفت صيانة المضيف. تحقق من التطبيق وأعد تعيين حالة المضيف قبل إعادة المحاولة.",
  "error.host.updateFailed":
    "فشل تحديث المضيف أثناء {phase}. تحقق من ملكية الحزمة والتوقيع وحالة المستأجر والمساحة الحرة على القرص قبل إعادة تعيين الحالة.",
  "error.host.tenantsNotIdle": "لم يبقَ المستأجرون خاملين لمدة خمس دقائق خلال ساعتين.",
  "error.host.tenantShutdownTimeout": "انتهت مهلة إيقاف المستأجر. لم يبدأ استبدال التطبيق.",
  "error.host.tenantHealthMissing":
    "تقارير سلامة المستأجرين مفقودة أو غير سليمة بعد إعادة التشغيل. افحص جلسات المستأجرين قبل تحديث آخر.",
  "error.host.personalityInvalid": "أسلوب الرد هذا غير معروف.",
} as const satisfies PartialTranslation<typeof source>;
