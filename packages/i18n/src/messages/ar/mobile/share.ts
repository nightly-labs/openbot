import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "سجّل الدخول للمشاركة",
  "mobile.share.signInDescription":
    "امسح رمز QR في OpenBot على حاسوبك. بعدها يمكنك اختيار الوكيل الذي يتلقى ما شاركته.",
  "mobile.share.reading": "جارٍ قراءة ما شاركته…",
  "mobile.share.readFailed": "تعذّر على OpenBot قراءة ما شاركته. شاركه مرة أخرى.",
  "mobile.share.content": "للمشاركة",
  "mobile.share.footer": "تُفتح الدردشة وهذا المحتوى في حقل الرسالة. لا يُرسل شيء حتى ترسله أنت.",
  "mobile.share.lastUsed": "آخر استخدام",
  "mobile.share.noAgents": "لا وكلاء",
  "mobile.share.chooseAgent": "اختر وكيلًا",
  "mobile.share.action": "مشاركة مع {name}",
  "mobile.share.extension.send": "إرسال",
  "mobile.share.extension.footer": "يرسل OpenBot هذا إلى الوكيل الآن. لا يُفتح التطبيق.",
  "mobile.share.extension.sending": "جارٍ الإرسال إلى {name}…",
  "mobile.share.extension.sent": "أُرسل إلى {name}",
  "mobile.share.extension.failed": "تعذّر على OpenBot إرسال هذا. افتح التطبيق لإرساله من هناك.",
  "mobile.share.extension.unconfirmed": "لم يؤكد الخادم الرسالة. تحقّق من الدردشة قبل أن ترسلها مرة أخرى.",
  "mobile.share.extension.openApp": "فتح OpenBot",
} as const satisfies PartialTranslation<typeof source>;
