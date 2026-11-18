import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "לא ניתן להתחבר. יש לבדוק את החיבור ולנסות שוב.",
  "error.kind.timeout": "הבקשה ארכה זמן רב מדי. יש לבדוק אם הפעולה הושלמה לפני שמנסים שוב.",
  "error.kind.storage": "אין מספיק מקום באחסון. יש לפנות מקום במחשב שמריץ את OpenBot ולנסות שוב.",
  "error.kind.filePermission": "ל-OpenBot אין הרשאה להשלים את הפעולה. יש לבדוק את הרשאות הקובץ או התיקייה ולנסות שוב.",
  "error.kind.notFound": "לא ניתן למצוא קובץ או תיקייה נדרשים. יש לשחזר אותם או לבחור אחרים ולנסות שוב.",
  "error.kind.readOnly": "התיקייה הזו לקריאה בלבד. יש לבחור תיקייה שאפשר לכתוב בה ולנסות שוב.",
  "error.kind.conflict": "כבר קיים פריט בשם הזה. יש לבחור שם אחר ולנסות שוב.",
  "error.kind.auth": "האימות נכשל. יש לבדוק את החשבון או את החיבור לשרת ולנסות שוב.",
  "error.kind.permission": "אין לך הרשאה להשלים את הפעולה. יש לבקש גישה מהבעלים.",
  "error.kind.rateLimit": "יותר מדי בקשות. יש להמתין רגע ולנסות שוב.",
  "error.kind.service": "השירות אינו זמין. יש להמתין רגע ולנסות שוב.",
} as const satisfies PartialTranslation<typeof source>;
