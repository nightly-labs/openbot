import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "מוצמדים",
  "mobile.carplay.new": "חדש",
  "mobile.carplay.agents": "סוכנים",
  "mobile.carplay.noAgents": "עדיין אין סוכנים",
  "mobile.carplay.locked": "בטל את נעילת OpenBot ב-iPhone",
  "mobile.carplay.signedOut": "התחבר ל-OpenBot ב-iPhone",
  "mobile.carplay.voice.listening": "מקשיב…",
  "mobile.carplay.voice.muted": "המיקרופון מושתק",
  "mobile.carplay.voice.thinking": "{name} חושב",
  "mobile.carplay.voice.offline": "השרת לא מחובר",
  "mobile.carplay.voice.unavailable": "הגדר קול ב-iPhone",
} as const satisfies PartialTranslation<typeof source>;
