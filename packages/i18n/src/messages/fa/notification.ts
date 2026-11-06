import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "به پاسخ شما نیاز دارد.",
  "notification.needsApproval": "به تأیید شما نیاز دارد.",
  "notification.needsBrowserStep": "لازم است مرحله‌ای را در مرورگر انجام دهید.",
  "notification.needsApprovalFor": "به تأیید شما نیاز دارد: {action}",
  "notification.finished": "کارش تمام شد.",
  "notification.workflowApproval": "یک مرحله منتظر تأیید شماست.",
  "notification.workflowOutput": "نتیجهٔ تازه‌ای از یک workflow آماده است.",
  "notification.failed": "با خطا متوقف شد.",
  "notification.subagentFailed": "یک زیرعامل با خطا متوقف شد.",
  "notification.subagentFailedFor": "یک زیرعامل با خطا متوقف شد: {task}",
  "notification.channelTitle": "{agent} در {channel}",
  "notification.channelMessage": "پیامی فرستاده شد.",
  "notification.usageLimit.title": "حساب {provider} به محدودیت خود رسیده است",
  "notification.usageLimit.body": {
    one: "{count} عامل منتظر است. OpenBot بعداً دوباره تلاش می‌کند.",
    other: "{count} عامل منتظرند. OpenBot بعداً دوباره تلاش می‌کند.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} عامل منتظر است. محدودیت در {reset} بازنشانی می‌شود.",
    other: "{count} عامل منتظرند. محدودیت در {reset} بازنشانی می‌شود.",
  },
  "notification.machineAlert.disk": "{server}: دیسک {percent} پر شده است",
  "notification.machineAlert.memory": "{server}: {percent} از حافظه استفاده شده است",
  "notification.machineAlert.cpu": "{server}: پردازنده {percent} مشغول است",
  "notification.machineAlert.body": "از آستانهٔ هشدار {level} عبور کرده است. تنظیمات سرور > فضای ذخیره‌سازی را ببینید.",
  "notification.test": "اعلان‌ها کار می‌کنند.",
  "notification.welcome": "اگر عاملی به شما نیاز داشته باشد، OpenBot اینجا خبر می‌دهد.",
  "notification.toast.region": "اعلان‌ها",
  "notification.toast.close": "بستن اعلان",
} as const satisfies PartialTranslation<typeof source>;
