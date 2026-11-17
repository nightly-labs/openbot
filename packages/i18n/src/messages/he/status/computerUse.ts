import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "מנהל ההתקן של שליטה במחשב לא הופעל. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "מנהל ההתקן של שליטה במחשב נעצר לפני שהספיק להשיב.",
  "status.computerUse.driverNoAnswer": "מנהל ההתקן של שליטה במחשב לא השיב. {reason}",
  "status.computerUse.driverStopped": "מנהל ההתקן של שליטה במחשב נעצר.",
  "status.computerUse.unsupported": "שליטה במחשב זמינה ב-macOS, ב-Windows וב-Linux.",
  "status.computerUse.driverMissing": "גרסת OpenBot הזו אינה כוללת מנהל התקן של שליטה במחשב.",
  "status.computerUse.restartRequired":
    "macOS עדיין חוסם את OpenBot מללחוץ ולהקליד, למרות ששתי ההרשאות מופעלות. יש להפעיל מחדש את OpenBot. אם זה חוזר, יש ללחוץ על ״ניהול״ ליד ״נגישות״, להסיר את OpenBot מהרשימה, להוסיף אותו שוב ולהפעיל מחדש את OpenBot.",
  "status.computerUse.progressActing": "משתמש באפליקציה במחשב הזה…",
  "status.computerUse.progressDeciding": "מחליט על הצעד הבא באפליקציה…",
} as const satisfies PartialTranslation<typeof source>;
