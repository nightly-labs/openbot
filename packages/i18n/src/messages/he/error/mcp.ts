import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "הכתובת הזו אינה נגישה לפי שם.",
  "error.mcp.redirectGetOnly": "הכתובת הזו מקבלת בקשות GET בלבד.",
  "error.mcp.redirectNotSignIn": "הכתובת הזו אינה חלק מהתחברות.",
  "error.mcp.redirectRefused": "ההתחברות נדחתה. יש לחזור אל OpenBot ולנסות שוב.",
  "error.mcp.redirectNoSignIn": "אין התחברות שממתינה לזה. ייתכן שהיא הסתיימה.",
  "error.mcp.redirectSignedIn": "OpenBot מחובר. אפשר לסגור את החלון הזה.",
  "error.mcp.signInFileUnreadable": "לא ניתן לקרוא את קובץ ההתחברות של MCP.",
  "error.mcp.signInFileTooLarge": "קובץ ההתחברות של MCP גדול מדי.",
  "error.mcp.unsupported": "שרתי MCP אינם נתמכים בשרת הזה.",
  "error.mcp.signInOnHost": "התחברות לשרת MCP פועלת רק ב-OpenBot במחשב המארח.",
  "error.mcp.signInAppUnsupported": "השרת הזה אינו תומך באפליקציות התחברות. יש לעדכן את OpenBot במארח.",
  "error.mcp.redirectRelayed": "OpenBot שלח את ההתחברות לשרת. אפשר לסגור את החלון הזה.",
  "error.mcp.relayEnded": "ההתחברות הזו הסתיימה. יש להתחיל אותה מחדש.",
  "error.mcp.relayNoState": "דף ההתחברות של השרת אינו מגן על כתובת החזרה שלו, ולכן OpenBot אינו פותח אותו במחשב הזה.",
  "error.mcp.relayAddressInvalid": "זו אינה הכתובת שבסוף ההתחברות הזו. יש להעתיק את הכתובת המלאה מהדפדפן.",
} as const satisfies PartialTranslation<typeof source>;
