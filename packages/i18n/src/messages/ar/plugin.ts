import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "الموقع الإلكتروني",
  "plugin.link.privacyPolicy": "سياسة الخصوصية",
  "plugin.link.terms": "شروط الخدمة",
  "plugin.copyLink": "نسخ الرابط",
  "plugin.askPrompt": "اسأل {name}: {prompt}",
  "plugin.section.skills": "المهارات",
  "plugin.section.information": "المعلومات",
  "plugin.info.developer": "المطوّر",
  "plugin.info.category": "الفئة",
  "plugin.info.version": "الإصدار",
  "plugin.uninstallDialog.title": "فصل {name}؟",
  "plugin.uninstallDialog.description":
    "يزيل هذا ما ثبّته {name} على هذا الحاسوب. لا يتغيّر أي شيء آخر على هذا المضيف أو على هذا الوكيل.",
  "plugin.uninstallDialog.confirm": "فصل",
  "plugin.uninstallDialog.appsLabel": "التطبيقات التي ستتم إزالتها، {number}",
  "plugin.uninstallDialog.appsTitle": "التطبيقات التي تمت إزالتها من هذا المضيف",
  "plugin.uninstallDialog.appsNote": "تتوقف أدواتها عن الإتاحة، وينسى OpenBot أي تسجيل دخول احتفظ به لها.",
  "plugin.uninstallDialog.skillsLabel": "المهارات التي ستتم إزالتها، {number}",
  "plugin.uninstallDialog.skillsTitle": "المهارات التي تمت إزالتها من {agentName}",
} as const satisfies PartialTranslation<typeof source>;
