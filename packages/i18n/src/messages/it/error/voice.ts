import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Impossibile scaricare il modello vocale. Riprova.",
  "error.voice.downloadStopped": "Il download del modello vocale è stato interrotto.",
  "error.voice.runtimeUnavailable": "La trascrizione vocale locale non è disponibile su questa piattaforma.",
  "error.voice.busy": "Una trascrizione vocale è già in corso.",
  "error.voice.modelUnavailable": "Il modello vocale non è disponibile.",
  "error.voice.transcriptionTimedOut": "La trascrizione vocale è scaduta.",
  "error.voice.prepareRequired":
    "La trascrizione vocale locale non è disponibile. Esegui `bun run voice:prepare` e riavvia OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot non è riuscito a trascrivere questa registrazione.",
} as const satisfies PartialTranslation<typeof source>;
