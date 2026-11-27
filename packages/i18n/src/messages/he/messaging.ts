import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack כבר לא מקבל את OpenBot בסביבת העבודה הזאת. ייתכן שהוא הוסר. יש לחבר את סביבת העבודה מחדש.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot לא יכול לקרוא את האסימונים השמורים במחשב הזה. יש לנתק את סביבת העבודה ואז לחבר אותה מחדש.",
  "messaging.help.relay_unavailable":
    "OpenBot לא יכול לקבל אירועי Slack במחשב הזה. יש להתחבר, לתת למחשב הזה שם בהגדרות השרת ולהשאיר את OpenBot פתוח.",
  "messaging.help.not_linked": 'סביבת העבודה הזו לא מקושרת לשרת הזה. בחרו "חיבור מחדש" כדי לקשר אותה.',
  "messaging.discordHelp.invalid_token":
    "Discord כבר לא מקבל את OpenBot בשרת ה-Discord הזה. ייתכן שהוא הוסר. יש לחבר את שרת ה-Discord מחדש.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot לא יכול לקרוא את האסימונים השמורים במחשב הזה. יש לנתק את שרת ה-Discord ואז לחבר אותו מחדש.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot לא יכול לקבל אירועי Discord במחשב הזה. יש להתחבר, לתת למחשב הזה שם בהגדרות השרת ולהשאיר את OpenBot פתוח.",
  "messaging.discordHelp.not_linked": 'שרת ה-Discord הזה לא מקושר לשרת ה-OpenBot הזה. בחרו "חיבור מחדש" כדי לקשר אותו.',
} as const satisfies PartialTranslation<typeof source>;
