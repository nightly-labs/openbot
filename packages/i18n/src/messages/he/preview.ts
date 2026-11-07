import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "תצוגה מקדימה של קובץ",
  "preview.panel.resize": "שינוי גודל התצוגה המקדימה",
  "preview.panel.copy": "העתקת טקסט הקובץ",
  "preview.panel.openExternally": "פתיחת הקובץ באפליקציה חיצונית",
  "preview.panel.download": "הורדת הקובץ",
  "preview.panel.reveal": "הצגת הקובץ ב-Finder",
  "preview.panel.close": "סגירת התצוגה המקדימה",
  "preview.panel.back": "חזרה",
  "preview.panel.rawMarkdown": "הצגת מקור Markdown",
  "preview.panel.rawHtml": "הצגת מקור HTML",
  "preview.panel.wrapLines": "גלישת שורות ארוכות",
  "preview.folder.empty": "התיקייה ריקה.",
  "preview.folder.truncated": "מוצגים רק {limit} הפריטים הראשונים.",
  "preview.truncated": "התצוגה המקדימה קוצרה אחרי {limit} תווים.",
  "preview.unavailable": "התצוגה המקדימה אינה זמינה.",
  "preview.unsupported.title": "התצוגה המקדימה אינה זמינה",
  "preview.unsupported.description": "אפשר לפתוח סוג קובץ זה באפליקציית ברירת המחדל שלו.",
  "preview.unsupported.openExternally": "פתיחה באפליקציה חיצונית",
  "preview.spreadsheet.readFailed": "לא ניתן לקרוא את הגיליון.",
  "preview.spreadsheet.truncated": "התצוגה המקדימה מוגבלת ל-{rows} השורות הראשונות ול-{columns} העמודות הראשונות.",
} as const satisfies PartialTranslation<typeof source>;
