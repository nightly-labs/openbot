import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Fissati",
  "mobile.carplay.new": "Nuovo",
  "mobile.carplay.agents": "Agenti",
  "mobile.carplay.noAgents": "Ancora nessun agente",
  "mobile.carplay.locked": "Sblocca OpenBot sul tuo iPhone",
  "mobile.carplay.signedOut": "Accedi a OpenBot sul tuo iPhone",
  "mobile.carplay.voice.listening": "In ascolto…",
  "mobile.carplay.voice.muted": "Microfono disattivato",
  "mobile.carplay.voice.thinking": "{name} sta pensando",
  "mobile.carplay.voice.offline": "Il server è offline",
  "mobile.carplay.voice.unavailable": "Configura la voce sul tuo iPhone",
} as const satisfies PartialTranslation<typeof source>;
