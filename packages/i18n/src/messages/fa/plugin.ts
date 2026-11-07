import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "وب‌سایت",
  "plugin.link.privacyPolicy": "سیاست حفظ حریم خصوصی",
  "plugin.link.terms": "شرایط استفاده",
  "plugin.copyLink": "کپی پیوند",
  "plugin.askPrompt": "از {name} بپرسید: {prompt}",
  "plugin.section.skills": "مهارت‌ها",
  "plugin.section.information": "اطلاعات",
  "plugin.info.developer": "توسعه‌دهنده",
  "plugin.info.category": "دسته‌بندی",
  "plugin.info.version": "نسخه",
  "plugin.uninstallDialog.title": "اتصال {name} قطع شود؟",
  "plugin.uninstallDialog.description": "مواردی را که {name} روی این رایانه نصب کرده حذف می‌کند. مورد دیگری در این میزبان یا این عامل تغییر نمی‌کند.",
  "plugin.uninstallDialog.confirm": "قطع اتصال",
  "plugin.uninstallDialog.appsLabel": "برنامه‌های قابل حذف، {number}",
  "plugin.uninstallDialog.appsTitle": "برنامه‌های حذف‌شده از این میزبان",
  "plugin.uninstallDialog.appsNote": "ابزارهای آن‌ها دیگر در دسترس نیستند و اطلاعات ورود ذخیره‌شدهٔ آن‌ها در OpenBot فراموش می‌شود.",
  "plugin.uninstallDialog.skillsLabel": "مهارت‌های قابل حذف، {number}",
  "plugin.uninstallDialog.skillsTitle": "مهارت‌های حذف‌شده از {agentName}",
} as const satisfies PartialTranslation<typeof source>;
