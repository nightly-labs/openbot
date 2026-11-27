import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "יש לבחור נתיב מוחלט לתיקיית האתר.",
  "error.site.rootSymlink": "קישורים סימבוליים אינם מותרים באתרים מתארחים.",
  "error.site.notDirectory": "מקור האתר חייב להיות תיקייה.",
  "error.site.outsideWorkspace": "האתר חייב להיות בתוך סביבת העבודה של הסוכן או ב-OpenBot Shared.",
  "error.site.packageJsonInvalid": "הקובץ package.json של האתר אינו תקין.",
  "error.site.astroServerOutput": "Astro חייב להשתמש בפלט סטטי.",
  "error.site.astroAdapter": "מתאמי שרת של Astro ושילוב React אינם מותרים.",
  "error.site.astroApiRoutes": "נתיבי API ופעולות שרת של Astro אינם מותרים.",
  "error.site.astroMiddleware": "תוכנת ביניים (middleware) ומקור שרת של Astro אינם מותרים.",
  "error.site.astroNotBuilt": "יש לבנות קודם את פרויקט Astro. התיקייה dist/ הקיימת שלו נדרשת.",
  "error.site.astroDistNotDirectory": "dist/ של Astro חייבת להיות תיקייה אמיתית.",
  "error.site.astroDistOutside": "dist/ של Astro חייבת להישאר בתוך תיקיית הפרויקט.",
  "error.site.directoryOutsideRoot": "תיקיות האתר חייבות להישאר בתוך שורש המקור.",
  "error.site.siteTooLarge": "האתר חורג ממגבלת 2 MB.",
  "error.site.missingIndex": "שורש האתר חייב לכלול את index.html.",
  "error.site.symlink": "קישורים סימבוליים אינם מותרים: {name}",
  "error.site.unsupportedEntry": "פריט לא נתמך באתר: {name}",
  "error.site.tooManyFiles": "אתר יכול להכיל עד {limit} קבצים.",
  "error.site.hiddenFile": "קבצים מוסתרים אינם מותרים: {path}",
  "error.site.unsafePath": "נתיב הקובץ הזה אינו מותר: {path}",
  "error.site.secretFile": "פרטי גישה, מפתחות פרטיים ומקור שרת אינם מותרים: {path}",
  "error.site.fileType": "סוג הקובץ הזה אינו מותר: {path}",
  "error.site.fileOutsideRoot": "קבצי האתר חייבים להישאר בתוך שורש המקור: {path}",
  "error.site.fileTooLarge": "קובץ חורג ממגבלת 1 MB: {path}",
  "error.site.serverLimit": {
    one: "השרת הגיע למגבלה של אתר פעיל אחד. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
    two: "השרת הגיע למגבלה של שני אתרים פעילים. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
    other:
      "השרת הגיע למגבלה של {count} אתרים פעילים. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
  },
  "error.site.sharedLimit":
    "השרתים בחשבון שלך ללא תוכנית חולקים את האתרים הפעילים שלהם, וכולם בשימוש. כדי לפרסם כאן אתר, יש למחוק אתר באחד מהשרתים האלה, להוסיף משתמשים לרישיון או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
  "error.site.accountLimit":
    "בחשבון שלך יש את המספר המרבי של אתרים פעילים בכל השרתים שלו: {count}. כדי לפרסם אתר נוסף, יש למחוק אתר.",
  "error.site.unlinkedLimit": {
    one: "המחשב הזה אינו שרת, והחשבון שלו הגיע למגבלה של אתר פעיל אחד. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
    two: "המחשב הזה אינו שרת, והחשבון שלו הגיע למגבלה של שני אתרים פעילים. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
    other:
      "המחשב הזה אינו שרת, והחשבון שלו הגיע למגבלה של {count} אתרים פעילים. כדי לפרסם אתר נוסף, יש למחוק אתר או להשתמש בשרת ענן עם תוכנית שכוללת יותר אתרים.",
  },
} as const satisfies PartialTranslation<typeof source>;
