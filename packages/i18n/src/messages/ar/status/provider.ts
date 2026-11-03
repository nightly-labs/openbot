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
} as const satisfies PartialTranslation<typeof source>;
