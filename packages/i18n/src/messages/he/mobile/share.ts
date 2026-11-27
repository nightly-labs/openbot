import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "התחברות לצורך שיתוף",
  "mobile.share.signInDescription":
    "יש לסרוק את קוד ה-QR ב-OpenBot במחשב. לאחר מכן אפשר לבחור את הסוכן שיקבל את מה ששיתפת.",
  "mobile.share.reading": "קורא את מה ששיתפת…",
  "mobile.share.readFailed": "OpenBot לא הצליח לקרוא את מה ששיתפת. יש לשתף שוב.",
  "mobile.share.content": "לשיתוף",
  "mobile.share.footer": "הצ'אט נפתח כשהתוכן הזה בשדה ההודעה. דבר לא נשלח עד שתשלח.",
  "mobile.share.sendFooter": "OpenBot שולח את זה לסוכן ואז פותח את הצ'אט.",
  "mobile.share.lastUsed": "בשימוש לאחרונה",
  "mobile.share.noAgents": "אין סוכנים",
  "mobile.share.chooseAgent": "בחירת סוכן",
  "mobile.share.action": "שיתוף עם {name}",
  "mobile.share.extension.send": "שליחה",
  "mobile.share.extension.footer": "OpenBot שולח את זה לסוכן עכשיו. האפליקציה לא נפתחת.",
  "mobile.share.extension.message": "הוספת הודעה",
  "mobile.share.extension.sending": "שולח אל {name}…",
  "mobile.share.extension.sent": "נשלח אל {name}",
  "mobile.share.extension.failed": "OpenBot לא הצליח לשלוח. יש לפתוח את האפליקציה ולשלוח משם.",
  "mobile.share.extension.unconfirmed": "השרת לא אישר את ההודעה. יש לבדוק בצ'אט לפני שליחה חוזרת.",
  "mobile.share.extension.openApp": "פתיחת OpenBot",
} as const satisfies PartialTranslation<typeof source>;
