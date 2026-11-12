import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "פתיחת הקובץ",
  "attachment.preview": "תצוגה מקדימה של {name}",
  "attachment.notFound": "הקובץ לא נמצא",
  "attachment.download": "הורדת {name}",
  "attachment.downloadProgress": "{received} מתוך {total}",
  "attachment.stopDownload": "עצירת ההורדה של {name}, {percent}%",
  "attachment.downloadFailed": "ההורדה נכשלה",
  "attachment.retryDownload": "ניסיון חוזר להורדת {name}",
  "attachment.open": "פתיחת {name}",
  "attachment.loadMedia": "הפעלת {name}",
  "attachment.previewUnavailable": "התצוגה המקדימה אינה זמינה.",
  "attachment.error.preview": "לא ניתן להציג תצוגה מקדימה של {name}. יש לנסות שוב.",
  "attachment.error.download": "לא ניתן להוריד את הקבצים המצורפים. יש לנסות שוב.",
  "attachment.error.open": "לא ניתן לפתוח או לשמור את הקובץ המצורף. יש לנסות שוב.",
  "attachment.error.openFile": "לא ניתן לפתוח את הקובץ. יש לנסות שוב.",
  "attachment.error.fileFallback": "קובץ",
  "attachment.error.fileNotFound": "״{name}״ לא נמצא בנתיב הזה. ייתכן שהוא הועבר או נמחק.",
  "attachment.error.previewFile": "לא ניתן להציג תצוגה מקדימה של ״{name}״. יש לנסות שוב.",
} as const satisfies PartialTranslation<typeof source>;
