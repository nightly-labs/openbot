import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "בחירה",
  "mobile.shared.crop.label": "חיתוך תמונה",
  "mobile.shared.crop.hint": "יש לגרור כדי להזיז את התמונה ולצבוט כדי לשנות את גודלה.",
  "mobile.shared.splash.loading": "טוען חשבון",
  "mobile.shared.photo.openFailed": "לא ניתן לפתוח את התמונה. יש לנסות שוב.",
  "mobile.shared.photo.tooLarge": "OpenBot לא הצליח להקטין את התמונה מספיק. יש לבחור תמונה פשוטה יותר.",
  "mobile.shared.save.changes": "שמירת שינויים",
} as const satisfies PartialTranslation<typeof source>;
