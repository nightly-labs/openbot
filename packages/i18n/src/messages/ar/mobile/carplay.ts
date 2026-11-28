import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "المثبّتة",
  "mobile.carplay.new": "جديد",
  "mobile.carplay.agents": "الوكلاء",
  "mobile.carplay.noAgents": "لا يوجد وكلاء بعد",
  "mobile.carplay.locked": "افتح قفل OpenBot على iPhone",
  "mobile.carplay.signedOut": "سجّل الدخول إلى OpenBot على iPhone",
  "mobile.carplay.voice.listening": "يستمع…",
  "mobile.carplay.voice.muted": "الميكروفون مكتوم",
  "mobile.carplay.voice.thinking": "{name} يفكر",
  "mobile.carplay.voice.offline": "الخادم غير متصل",
  "mobile.carplay.voice.unavailable": "اضبط الصوت على iPhone",
} as const satisfies PartialTranslation<typeof source>;
