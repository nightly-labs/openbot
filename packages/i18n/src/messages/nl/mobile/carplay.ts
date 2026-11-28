import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Vastgezet",
  "mobile.carplay.new": "Nieuw",
  "mobile.carplay.agents": "Agents",
  "mobile.carplay.noAgents": "Nog geen agents",
  "mobile.carplay.locked": "Ontgrendel OpenBot op je iPhone",
  "mobile.carplay.signedOut": "Log in bij OpenBot op je iPhone",
  "mobile.carplay.voice.listening": "Luistert…",
  "mobile.carplay.voice.muted": "Gedempt",
  "mobile.carplay.voice.thinking": "{name} denkt na",
  "mobile.carplay.voice.offline": "De server is offline",
  "mobile.carplay.voice.unavailable": "Stel spraak in op je iPhone",
} as const satisfies PartialTranslation<typeof source>;
