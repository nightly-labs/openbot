import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal לא סיפק שרתי ICE.",
  "error.host.keyRotationUnavailable": "השרת הזה לא יכול להחליף את המפתח שלו ללא שירות החשבונות.",
  "error.host.keyRotationRefused": "שירות החשבונות לא קיבל את מפתח השרת החדש. המפתח הנוכחי נשאר בשימוש.",
  "error.host.webRtcNotConfigured": "שירות המארח של WebRTC לא הוגדר.",
  "error.host.runtimeNotInstalled": "סביבת הריצה של שולחן עבודה מרוחק אינה מותקנת.",
  "error.host.setupUnavailable": "הגדרת ההרשאות אינה זמינה.",
  "error.host.accountChangedDuringUpdate": "החשבון המחובר השתנה בזמן עדכון השרת הזה.",
  "error.host.nameBeforePublish": "יש לתת ל-OpenBot הזה שם לפני הפרסום.",
  "error.host.memberNotFound": "החבר המרוחק לא קיים.",
  "error.host.publishBeforeInvite": "יש להפוך את OpenBot הזה לציבורי לפני יצירת הזמנה.",
  "error.host.teamAccessUnavailable": "הגישה לצוות שלך אינה זמינה.",
  "error.host.ownerIdentityUnavailable": "זהות הבעלים של המארח אינה זמינה.",
  "error.host.reserveAddressFailed": "לא ניתן לשמור את הכתובת הציבורית.",
  "error.host.publishFailed": "לא ניתן לפרסם את OpenBot הזה.",
  "error.host.mobileConnectPublishFailed": "לא ניתן לפרסם את OpenBot הזה עבור Mobile Connect.",
  "error.host.mobileConnectHostChanged": "המארח של Mobile Connect השתנה. יש לנסות שוב.",
  "error.host.noServer": "במחשב הזה אין שרת לשינוי.",
  "error.host.identityLocalOnly": "אפשר לשנות את שם השרת ואת הלוגו שלו רק במחשב שמריץ אותו.",
  "error.host.timezoneInvalid": "אזור הזמן הזה אינו מוכר.",
  "error.host.turnLimitInvalid": "מגבלת השרשורים הזו אינה תקינה.",
  "error.host.maintenanceInterrupted":
    "תחזוקת המארח הופסקה. יש לוודא את האפליקציה ולאפס את מצב המארח לפני ניסיון נוסף.",
  "error.host.updateFailed":
    "עדכון המארח נכשל בשלב {phase}. יש לוודא בעלות על החבילה, חתימה, מצב הדיירים ושטח פנוי בדיסק לפני איפוס המצב.",
  "error.host.tenantsNotIdle": "הדיירים לא נשארו ללא פעילות במשך חמש דקות בתוך שעתיים.",
  "error.host.tenantShutdownTimeout": "כיבוי הדיירים חרג מהזמן המותר. החלפת האפליקציה לא התחילה.",
  "error.host.tenantHealthMissing":
    "דוחות התקינות של הדיירים חסרים או לא תקינים לאחר ההפעלה מחדש. יש לבדוק את הסשנים של הדיירים לפני עדכון נוסף.",
  "error.host.personalityInvalid": "סגנון התגובה הזה אינו מוכר.",
} as const satisfies PartialTranslation<typeof source>;
