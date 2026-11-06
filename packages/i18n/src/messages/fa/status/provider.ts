import { defineMessages } from "../../../message";

export const messages = defineMessages("status.provider", {
  // Provider runtime download status.
  "status.provider.downloadStopped": "بارگیری متوقف شد. دوباره تلاش کنید.",
  "status.provider.downloadFailed": "بارگیری ناموفق بود. دوباره تلاش کنید.",
  "status.provider.updateWaiting": "به‌روزرسانی پس از پایان نوبت فعلی شروع می‌شود.",
  "status.provider.confirmContinue": "ادامه",
  "status.provider.confirmCancel": "لغو",
  // A provider that tries a failed API request again during a turn.
  "status.provider.retryUnreachable": "{provider} نمی‌تواند به سرورش وصل شود. تلاش {attempt} از {maxAttempts}.",
  "status.provider.retryServerError": "سرور {provider} مشغول است یا خطایی دارد. تلاش {attempt} از {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} دوباره از سرورش پاسخ می‌گیرد.",
});
