import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "בגרסה הזו של OpenBot אין אפליקציה לגרירה.",
  "error.computerUse.helpWindowChanged": "חלון העזרה להרשאות השתנה לפני תחילת הגרירה.",
  "error.computerUse.noAppToShow": "בגרסה הזו של OpenBot אין אפליקציה להצגה.",
  "error.computerUse.noDriver": "במחשב הזה אין מנהל התקן לשליטה במחשב.",
  "error.computerUse.socketPathTooLong": "נתיב הסוקט של שליטה במחשב באורך {length} תווים, והמערכת מאפשרת {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "הנתיב {path} של תיקיית הסוקט של שליטה במחשב אינו תיקייה.",
  "error.computerUse.socketDirectoryOtherOwner": "תיקיית הסוקט {path} של שליטה במחשב שייכת למשתמש אחר.",
  "error.computerUse.socketDirectoryShared": "תיקיית הסוקט {path} של שליטה במחשב פתוחה למשתמשים אחרים.",
  "error.computerUse.socketNotReady": "לא התקבל חיבור תוך {seconds} שניות. {reason}",
} as const satisfies PartialTranslation<typeof source>;
