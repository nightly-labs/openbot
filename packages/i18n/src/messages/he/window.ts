import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot מארח מקומי",
  "window.localClientTitle": "OpenBot לקוח מקומי",
  "window.computerUsePermissionTitle": "הפעלת שליטה במחשב",
  "window.rendererStoppedTitle": "OpenBot הפסיק לעבוד",
  "window.rendererStoppedBody": "החלון נעצר כמה פעמים. הצ׳אטים שלך שמורים, והסוכנים שלך ממשיכים לעבוד.",
  "window.rendererStoppedReload": "טעינה מחדש",
  "window.minimize": "מזער",
  "window.maximize": "הגדל",
  "window.restore": "שחזר",
} as const satisfies PartialTranslation<typeof source>;
