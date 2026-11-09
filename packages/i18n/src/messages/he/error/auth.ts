import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable": "OpenBot לא הצליח להגיע לשירות החשבון. יש לוודא שה-API פועל ולנסות שוב.",
  "error.auth.networkBlocked":
    "חומת אש או שרת proxy ברשת הזו חסמו את הגישה של OpenBot אל {host}. יש לבקש ממנהל הרשת לאפשר את {host} ולנסות שוב.",
  "error.auth.signInFirst": "יש להתחבר תחילה ל-OpenBot.",
  "error.auth.signInRequired": "נדרשת התחברות.",
  "error.auth.chatColorUnavailable": "שירות החשבון עדיין אינו תומך בצבעי צ'אט. יש לנסות שוב מאוחר יותר.",
  "error.auth.accountChangedDuringRegister": "החשבון המחובר השתנה בזמן רישום השרת הזה.",
  "error.auth.hostCredentialUnavailable": "פרטי הגישה של המארח המרוחק אינם זמינים. יש לרשום את המארח שוב.",
  "error.auth.codeNotVerified": "לא ניתן היה לאמת את קוד ההתחברות.",
  "error.auth.serviceError": "שירות החשבון החזיר שגיאה.",
  "error.auth.serviceUnreachable": "OpenBot לא הצליח להגיע לשירות החשבון. יש לבדוק את החיבור ולנסות שוב.",
  "error.auth.serviceTimeout": "שירות החשבון לא הגיב בזמן. יש לנסות שוב.",
  "error.auth.serviceStatus": "שירות החשבון החזיר שגיאה ({status}). יש לנסות שוב מאוחר יותר.",
  "error.auth.invalidHostedServer": "שירות החשבון החזיר שרת מאוחסן לא תקין.",
  "error.auth.codeNotSent": "OpenBot לא הצליח לשלוח את קוד ההתחברות.",
  "error.auth.deliveryTimeout":
    "OpenBot לא הצליח לאשר את המשלוח בזמן. ייתכן שהקוד עדיין יגיע. יש לבדוק את המשלוח לפני שליחה חוזרת.",
  "error.auth.deliveryInterrupted":
    "החיבור הסתיים לפני ש-OpenBot אישר את המשלוח. יש לבדוק את המשלוח כדי לא לשלוח קוד נוסף.",
  "error.auth.deliveryUnknown": "OpenBot לא הצליח לאשר אם קוד ההתחברות נשלח. יש לבדוק את המשלוח לפני שליחה חוזרת.",
  "error.auth.companySignInFailed": "ההתחברות דרך החברה לא הסתיימה. יש לנסות שוב.",
  "error.auth.companySignInCancelled": "ההתחברות דרך החברה בוטלה.",
  "error.auth.companySignInTimeout": "ההתחברות דרך החברה לקחה זמן רב מדי. יש לפתוח שוב את דף ההתחברות.",
  "error.auth.companySignInRefused": "ההתחברות בחברה שלך בוטלה או נדחתה.",
  "error.auth.companySignInDomainMismatch": "לחשבון החברה יש אימייל בדומיין שאינו כלול בהגדרה.",
  "error.auth.companySignInAccountDisabled": "החברה שלך כיבתה את החשבון הזה. יש לפנות למנהל המערכת.",
  "error.auth.companySignInOff": "ההתחברות דרך החברה כבויה עבור האימייל הזה.",
  "error.auth.companySignInEmailMissing": "חשבון החברה שלך לא סיפק כתובת אימייל מאומתת.",
  "error.auth.companySignInUnavailable": "OpenBot הזה לא יכול לפתוח דפדפן להתחברות דרך החברה.",
  "error.auth.companySignInProviderRejected": "הספק לא קיבל את מזהה הלקוח או את הסוד.",
  "error.auth.companySignInTokenInvalid": "הספק החזיר התחברות ש-OpenBot לא יכול לבדוק.",
  "error.auth.companySignInProviderUnreachable": "ספק ההתחברות של החברה לא הגיב.",
  "error.auth.companySignInDomainTaken": "אחד מהדומיינים האלה כבר מתחבר דרך שרת אחר.",
  "error.auth.companySignInNoServer": "יש להפעיל את השרת הזה לפני הגדרת התחברות דרך החברה.",
} as const satisfies PartialTranslation<typeof source>;
