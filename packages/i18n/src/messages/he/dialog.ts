import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "בחירת תיקייה של אתר סטטי",
  "dialog.chooseAgentFolder": "בחירת תיקייה עבור {agent}",
  "dialog.chooseAgentExclusion": "בחירת תיקייה ש-{agent} אינו רשאי לשנות",
  "dialog.chooseSkill": "בחירת תיקיית מיומנות או קובץ ZIP",
  "dialog.filter.skillPackages": "חבילות מיומנויות",
  "dialog.filter.images": "תמונות",
  "dialog.filter.supportedFiles": "קבצים נתמכים",
  "dialog.filter.attachment": "קובץ מצורף",
  "dialog.filter.zipArchive": "ארכיון ZIP",
  "dialog.filter.jsonDocument": "מסמך JSON",
  "dialog.chooseAgentExport": "בחירת ייצוא של סוכן",
  "dialog.chooseHermesFolder": "בחירת התיקייה של Hermes",
  "dialog.filter.agentExports": "ייצואי סוכנים",
  "dialog.chooseVaultCsv": "בחירת ייצוא סיסמאות",
  "dialog.filter.csv": "קובצי CSV",
  "dialog.saveExportSkill": "שמירת מיומנות הייצוא",
  "dialog.saveTransfer": "שמירת קובץ ההעברה",
  "dialog.chooseTransfer": "בחירת קובץ העברה",
  "dialog.filter.transfer": "קובצי העברה של OpenBot",
  "dialog.chooseExternalLinkApp": "בחירת דפדפן",
  "dialog.filter.applications": "אפליקציות",
} as const satisfies PartialTranslation<typeof source>;
