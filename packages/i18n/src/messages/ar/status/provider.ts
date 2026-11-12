import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "توقّف التنزيل. أعد المحاولة.",
  "status.provider.downloadFailed": "فشل التنزيل. أعد المحاولة.",
  "status.provider.updateWaiting": "يبدأ التحديث عند انتهاء الدور الحالي.",
  "status.provider.confirmContinue": "متابعة",
  "status.provider.confirmCancel": "إلغاء",
  "status.provider.retryUnreachable": "لا يستطيع {provider} الاتصال بخادمه. المحاولة {attempt} من {maxAttempts}.",
  "status.provider.retryServerError": "خادم {provider} مشغول أو به خطأ. المحاولة {attempt} من {maxAttempts}.",
  "status.provider.retryRecovered": "يتلقى {provider} الإجابات من خادمه مجددًا.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "أجاب Claude بالسرعة العادية. مع اشتراك Claude، يستخدم الوضع السريع أرصدة الاستخدام. شغّلها في حسابك على Claude.",
  "status.provider.claudeFastModeNotOnPlan": "أجاب Claude بالسرعة العادية. لا تتضمن خطة Claude الخاصة بك الوضع السريع.",
  "status.provider.claudeFastModeNotFirstParty":
    "أجاب Claude بالسرعة العادية. يعمل الوضع السريع فقط مع مفتاح Anthropic API أو اشتراك Claude، وليس مع Bedrock أو Vertex أو Foundry أو بوابة.",
  "status.provider.claudeFastModeModelNotAllowed":
    "أجاب Claude بالسرعة العادية. لا يمكن لهذا النموذج استخدام الوضع السريع في حسابك.",
  "status.provider.claudeFastModeTurnedOff":
    "أجاب Claude بالسرعة العادية. الوضع السريع متوقف في إعدادات Claude Code أو من قِبل مؤسستك.",
  "status.provider.claudeFastModeUnavailable":
    "أجاب Claude بالسرعة العادية. تعذّر على Claude Code استخدام الوضع السريع في هذا الدور.",
} as const satisfies PartialTranslation<typeof source>;
