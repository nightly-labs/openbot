import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Sabitlenenler",
  "mobile.carplay.new": "Yeni",
  "mobile.carplay.agents": "Ajanlar",
  "mobile.carplay.noAgents": "Henüz ajan yok",
  "mobile.carplay.locked": "iPhone'unuzda OpenBot'un kilidini açın",
  "mobile.carplay.signedOut": "iPhone'unuzda OpenBot'a giriş yapın",
  "mobile.carplay.voice.listening": "Dinleniyor…",
  "mobile.carplay.voice.muted": "Sessize alındı",
  "mobile.carplay.voice.thinking": "{name} düşünüyor",
  "mobile.carplay.voice.offline": "Sunucu çevrimdışı",
  "mobile.carplay.voice.unavailable": "iPhone'unuzda sesi ayarlayın",
} as const satisfies PartialTranslation<typeof source>;
