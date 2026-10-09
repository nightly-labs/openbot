import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Das Sprachmodell konnte nicht heruntergeladen werden. Versuche es erneut.",
  "error.voice.downloadStopped": "Der Download des Sprachmodells wurde gestoppt.",
  "error.voice.runtimeUnavailable": "Lokale Sprachtranskription ist auf dieser Plattform nicht verfügbar.",
  "error.voice.busy": "Eine Sprachtranskription läuft bereits.",
  "error.voice.modelUnavailable": "Das Sprachmodell ist nicht verfügbar.",
  "error.voice.transcriptionTimedOut": "Die Zeit für die Sprachtranskription ist abgelaufen.",
  "error.voice.prepareRequired":
    "Lokale Sprachtranskription ist nicht verfügbar. Führe `bun run voice:prepare` aus und starte OpenBot neu.",
  "error.voice.transcriptionFailed": "OpenBot konnte diese Aufnahme nicht transkribieren.",
} as const satisfies PartialTranslation<typeof source>;
