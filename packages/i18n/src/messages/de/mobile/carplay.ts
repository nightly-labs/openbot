import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Angeheftet",
  "mobile.carplay.new": "Neu",
  "mobile.carplay.agents": "Agenten",
  "mobile.carplay.noAgents": "Noch keine Agenten",
  "mobile.carplay.locked": "Entsperre OpenBot auf deinem iPhone",
  "mobile.carplay.signedOut": "Melde dich auf deinem iPhone bei OpenBot an",
  "mobile.carplay.voice.listening": "Hört zu …",
  "mobile.carplay.voice.muted": "Stummgeschaltet",
  "mobile.carplay.voice.thinking": "{name} denkt nach",
  "mobile.carplay.voice.offline": "Der Server ist offline",
  "mobile.carplay.voice.unavailable": "Richte die Stimme auf deinem iPhone ein",
} as const satisfies PartialTranslation<typeof source>;
