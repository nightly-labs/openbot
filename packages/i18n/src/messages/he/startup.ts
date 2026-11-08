import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot לא הצליח להיפתח",
  "startup.failedBody":
    "{message}\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו. בצעדי השחזור שבמדריך לפתרון בעיות אפשר לקרוא איך להמשיך.",
  "startup.archiveChangedTitle": "קובצי OpenBot שונו",
  "startup.archiveChangedBody":
    "תוכנה אחרת שינתה את קובץ OpenBot app.asar. OpenBot פועל כעת, אך לא ייפתח לאחר היציאה ממנו.\n\nכדי לתקן את OpenBot, יש להתקין אותו מחדש. הנתונים המקומיים נשמרים.",
  "startup.archiveChangedDownload": "הורדת OpenBot",
  "startup.newerDataUpdatingTitle": "OpenBot מתעדכן",
  "startup.newerDataUpdatingBody":
    "גרסה חדשה יותר של OpenBot שמרה את הנתונים שלך. OpenBot מתקין את הגרסה האחרונה ואז נפתח מחדש.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.newerDataTitle": "התקנת OpenBot העדכני ביותר",
  "startup.newerDataBody":
    "גרסה חדשה יותר של OpenBot שמרה את הנתונים שלך, והגרסה הזו ({version}) אינה יכולה לפתוח אותם. יש להתקין את הגרסה האחרונה כדי לפתוח את הנתונים.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.newerDataDownload": "הורדת OpenBot",
  "startup.newerDataGuide": "פתיחת המדריך",
  "startup.newerDataQuit": "יציאה",
} as const satisfies PartialTranslation<typeof source>;
