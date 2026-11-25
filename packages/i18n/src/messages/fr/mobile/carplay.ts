import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Épinglés",
  "mobile.carplay.new": "Nouveau",
  "mobile.carplay.agents": "Agents",
  "mobile.carplay.noAgents": "Aucun agent pour l’instant",
  "mobile.carplay.locked": "Déverrouillez OpenBot sur votre iPhone",
  "mobile.carplay.signedOut": "Connectez-vous à OpenBot sur votre iPhone",
  "mobile.carplay.voice.listening": "Écoute…",
  "mobile.carplay.voice.muted": "Micro coupé",
  "mobile.carplay.voice.thinking": "{name} réfléchit",
  "mobile.carplay.voice.offline": "Le serveur est hors ligne",
  "mobile.carplay.voice.unavailable": "Configurez la voix sur votre iPhone",
} as const satisfies PartialTranslation<typeof source>;
