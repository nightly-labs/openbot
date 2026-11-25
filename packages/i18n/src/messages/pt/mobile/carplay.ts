import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Fixados",
  "mobile.carplay.new": "Novo",
  "mobile.carplay.agents": "Agentes",
  "mobile.carplay.noAgents": "Ainda não há agentes",
  "mobile.carplay.locked": "Desbloqueie o OpenBot no iPhone",
  "mobile.carplay.signedOut": "Entre no OpenBot no iPhone",
  "mobile.carplay.voice.listening": "Ouvindo…",
  "mobile.carplay.voice.muted": "Silenciado",
  "mobile.carplay.voice.thinking": "{name} está pensando",
  "mobile.carplay.voice.offline": "O servidor está offline",
  "mobile.carplay.voice.unavailable": "Configure a voz no iPhone",
} as const satisfies PartialTranslation<typeof source>;
