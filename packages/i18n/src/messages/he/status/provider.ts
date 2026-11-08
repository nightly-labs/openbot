import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "ההורדה נעצרה. יש לנסות שוב.",
  "status.provider.downloadFailed": "ההורדה נכשלה. יש לנסות שוב.",
  "status.provider.updateWaiting": "העדכון יתחיל כשהפעולה הנוכחית תסתיים.",
  "status.provider.confirmContinue": "המשך",
  "status.provider.confirmCancel": "ביטול",
  "status.provider.retryUnreachable": "{provider} לא מצליח להתחבר לשרת שלו. ניסיון {attempt} מתוך {maxAttempts}.",
  "status.provider.retryServerError": "השרת של {provider} עמוס או שיש בו שגיאה. ניסיון {attempt} מתוך {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} מקבל שוב תשובות מהשרת שלו.",
} as const satisfies PartialTranslation<typeof source>;
