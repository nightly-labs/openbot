import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "אפשר לפתוח בדפדפן החיצוני רק קישורי HTTP(S).",
  "error.app.notificationsUnsupported": "המערכת הזו אינה תומכת בהתראות שולחן עבודה.",
  "error.app.notificationSettingsMissing": "במערכת הזו אין דף הגדרות התראות.",
  "error.app.notReady": "OpenBot אינו מוכן.",
  "error.app.macSecureStorageUnavailable": "האחסון המאובטח של macOS אינו זמין.",
  "error.app.secretStorageUnavailable": "אחסון הסודות של המערכת אינו זמין.",
  "error.app.remoteIdentityUnavailable": "זהות המארח המרוחק אינה זמינה.",
  "error.app.iceServersMissing": "Remote Signal עדיין לא סיפק שרתי ICE.",
  "error.app.finishLocalTest": "יש לסיים את הבדיקה המקומית לפני החלפת תצוגות.",
} as const satisfies PartialTranslation<typeof source>;
