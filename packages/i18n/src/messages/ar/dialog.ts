import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "اختر مجلد موقع ثابت",
  "dialog.chooseAgentFolder": "اختر مجلدًا لـ {agent}",
  "dialog.chooseAgentExclusion": "اختر مجلدًا يجب ألا يغيّره {agent}",
  "dialog.chooseSkill": "اختر مجلد مهارة أو ملف ZIP",
  "dialog.filter.skillPackages": "حزم المهارات",
  "dialog.filter.images": "الصور",
  "dialog.filter.supportedFiles": "الملفات المدعومة",
  "dialog.filter.attachment": "مرفق",
  "dialog.filter.zipArchive": "أرشيف ZIP",
  "dialog.filter.jsonDocument": "مستند JSON",
  "dialog.chooseAgentExport": "اختر ملف تصدير وكيل",
  "dialog.chooseHermesFolder": "اختر مجلد Hermes",
  "dialog.filter.agentExports": "ملفات تصدير الوكلاء",
  "dialog.chooseVaultCsv": "اختر ملف تصدير كلمات المرور",
  "dialog.filter.csv": "ملفات CSV",
  "dialog.saveExportSkill": "حفظ مهارة التصدير",
  "dialog.saveTransfer": "حفظ ملف النقل",
  "dialog.chooseTransfer": "اختر ملف نقل",
  "dialog.filter.transfer": "ملفات نقل OpenBot",
  "dialog.chooseExternalLinkApp": "اختر متصفحًا",
  "dialog.filter.applications": "التطبيقات",
} as const satisfies PartialTranslation<typeof source>;
