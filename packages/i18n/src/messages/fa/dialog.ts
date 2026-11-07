import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "پوشهٔ سایت ایستا را انتخاب کنید",
  "dialog.chooseAgentFolder": "پوشه‌ای برای {agent} انتخاب کنید",
  "dialog.chooseAgentExclusion": "پوشه‌ای را انتخاب کنید که {agent} نباید تغییر دهد",
  "dialog.chooseSkill": "پوشهٔ skill یا فایل ZIP را انتخاب کنید",
  "dialog.filter.skillPackages": "بسته‌های skill",
  "dialog.filter.images": "تصاویر",
  "dialog.filter.supportedFiles": "فایل‌های پشتیبانی‌شده",
  "dialog.filter.attachment": "پیوست",
  "dialog.filter.zipArchive": "بایگانی ZIP",
  "dialog.filter.jsonDocument": "سند JSON",
  "dialog.chooseAgentExport": "خروجی agent را انتخاب کنید",
  "dialog.chooseHermesFolder": "پوشهٔ Hermes را انتخاب کنید",
  "dialog.filter.agentExports": "خروجی‌های agent",
  "dialog.chooseVaultCsv": "خروجی گذرواژه‌ها را انتخاب کنید",
  "dialog.filter.csv": "فایل‌های CSV",
  "dialog.saveExportSkill": "skill خروجی را ذخیره کنید",
  "dialog.saveTransfer": "فایل انتقال را ذخیره کنید",
  "dialog.chooseTransfer": "فایل انتقال را انتخاب کنید",
  "dialog.filter.transfer": "فایل‌های انتقال OpenBot",
  "dialog.chooseExternalLinkApp": "مرورگر را انتخاب کنید",
  "dialog.filter.applications": "برنامه‌ها",
} as const satisfies PartialTranslation<typeof source>;
