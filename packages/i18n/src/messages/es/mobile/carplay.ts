import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Fijados",
  "mobile.carplay.new": "Nuevo",
  "mobile.carplay.agents": "Agentes",
  "mobile.carplay.noAgents": "Aún no hay agentes",
  "mobile.carplay.locked": "Desbloquea OpenBot en tu iPhone",
  "mobile.carplay.signedOut": "Inicia sesión en OpenBot en tu iPhone",
  "mobile.carplay.voice.listening": "Escuchando…",
  "mobile.carplay.voice.muted": "Silenciado",
  "mobile.carplay.voice.thinking": "{name} está pensando",
  "mobile.carplay.voice.offline": "El servidor está sin conexión",
  "mobile.carplay.voice.unavailable": "Configura la voz en tu iPhone",
} as const satisfies PartialTranslation<typeof source>;
