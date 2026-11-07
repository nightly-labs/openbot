import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "במחשב הזה אין אחסון סודות, ולכן הכספת אינה יכולה לשמור פריטים.",
  "error.vault.unreadable": "לא ניתן לקרוא את קובץ הכספת. יש לאפס את הכספת כדי להשתמש בה שוב.",
  "error.vault.tooLarge": "הכספת מלאה. יש למחוק כמה פריטים ולנסות שוב.",
  "error.vault.itemMissing": "הפריט הזה כבר אינו בכספת.",
  "error.vault.valueTooLong": "אחד הערכים ארוך מדי.",
  "error.vault.websiteInvalid": "יש להזין כתובת אתר HTTPS.",
  "error.vault.passwordRequired": "יש להזין סיסמה.",
  "error.vault.cardNumberInvalid": "יש להזין מספר כרטיס תקין.",
  "error.vault.securityCodeInvalid": "יש להזין קוד אבטחה בן 3 או 4 ספרות.",
  "error.vault.expiryInvalid": "יש להזין חודש ושנה תקינים לתפוגה.",
  "error.vault.contactEmpty": "יש להזין שם, כתובת, מספר טלפון או כתובת אימייל.",
  "error.vault.contactMissing": "איש הקשר לחיוב כבר אינו בכספת.",
  "error.vault.apiKeyRequired": "יש להזין מפתח API.",
  "error.vault.apiKeyNameInvalid":
    "יש להזין שם משתנה עם אותיות גדולות A–Z, ספרות ו-_, שמתחיל באות, כמו OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "בכספת כבר יש מפתח API עם שם המשתנה הזה.",
  "error.vault.csvInvalid": "הקובץ הזה אינו ייצוא סיסמאות בפורמט CSV.",
  "error.vault.csvTooLarge": "קובץ ה-CSV גדול מדי.",
} as const satisfies PartialTranslation<typeof source>;
