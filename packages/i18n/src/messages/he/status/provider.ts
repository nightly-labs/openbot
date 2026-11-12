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
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude ענה במהירות הרגילה. עם מינוי Claude, המצב המהיר משתמש בקרדיטים לשימוש. יש להפעיל אותם בחשבון Claude.",
  "status.provider.claudeFastModeNotOnPlan": "Claude ענה במהירות הרגילה. תוכנית Claude שלך לא כוללת את המצב המהיר.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude ענה במהירות הרגילה. המצב המהיר פועל רק עם מפתח API של Anthropic או מינוי Claude, לא עם Bedrock,‏ Vertex,‏ Foundry או שער.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude ענה במהירות הרגילה. המודל הזה לא יכול להשתמש במצב המהיר בחשבון שלך.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude ענה במהירות הרגילה. המצב המהיר כבוי בהגדרות Claude Code או על ידי הארגון שלך.",
  "status.provider.claudeFastModeUnavailable":
    "Claude ענה במהירות הרגילה. Claude Code לא הצליח להשתמש במצב המהיר בתור הזה.",
} as const satisfies PartialTranslation<typeof source>;
