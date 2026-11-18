import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "טבלאות",
  "sharedTable.description": "מה שהסוכנים שומרים בין משימות, עם הסוכן שהתחיל כל קבוצת רשומות",
  "sharedTable.close": "סגירת הטבלאות",
  "sharedTable.loading": "טוען טבלאות…",
  "sharedTable.empty":
    "אין טבלאות עדיין. סוכן יוצר טבלה בעצמו כשמשימה צריכה רשומות בין תורות, וכל סוכן יכול להשתמש בה.",
  "sharedTable.loadFailed": "לא ניתן לטעון את הטבלאות.",
  "sharedTable.deleteFailed": "לא ניתן למחוק את זה.",
  "sharedTable.madeOutside": "נוצר מחוץ ל-OpenBot · כל סוכן יכול למחוק אותו",
  "sharedTable.keptBy": "נשמר על ידי {name}",
  "sharedTable.keptByDeleted": "נשמר על ידי סוכן שכבר לא קיים",
  "sharedTable.deleteName": "מחיקת {name}",
  "sharedTable.confirmDelete": "למחוק את זה עבור כל הסוכנים? אי אפשר לשחזר את הרשומות.",
  "sharedTable.notCounted": "לא נספר",
  "sharedTable.records": { one: "רשומה אחת", two: "שתי רשומות", other: "{count} רשומות" },
} as const satisfies PartialTranslation<typeof source>;
