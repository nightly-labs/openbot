import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Przypięte",
  "mobile.carplay.new": "Nowe",
  "mobile.carplay.agents": "Agenci",
  "mobile.carplay.noAgents": "Brak agentów",
  "mobile.carplay.locked": "Odblokuj OpenBot na iPhonie",
  "mobile.carplay.signedOut": "Zaloguj się do OpenBot na iPhonie",
  "mobile.carplay.voice.listening": "Słucham…",
  "mobile.carplay.voice.muted": "Wyciszono",
  "mobile.carplay.voice.thinking": "{name} myśli",
  "mobile.carplay.voice.offline": "Serwer jest offline",
  "mobile.carplay.voice.unavailable": "Skonfiguruj głos na iPhonie",
} as const satisfies PartialTranslation<typeof source>;
