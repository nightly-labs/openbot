import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Impossibile scaricare il modello vocale. Riprova.",
  "error.voice.downloadStopped": "Il download del modello vocale è stato interrotto.",
  "error.voice.removeBusy": "Attendi la fine della trascrizione vocale, poi rimuovi il modello.",
  "error.voice.removeFailed": "Impossibile rimuovere il modello vocale. Riprova.",
  "error.voice.runtimeUnavailable": "La trascrizione vocale locale non è disponibile su questa piattaforma.",
  "error.voice.busy": "Una trascrizione vocale è già in corso.",
  "error.voice.modelUnavailable": "Il modello vocale non è disponibile.",
  "error.voice.transcriptionTimedOut": "La trascrizione vocale è scaduta.",
  "error.voice.prepareRequired":
    "La trascrizione vocale locale non è disponibile. Esegui `bun run voice:prepare` e riavvia OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot non è riuscito a trascrivere questa registrazione.",
  "error.voice.cloud.keyRequired": "Aggiungi la tua chiave API di ElevenLabs in Impostazioni → Voce.",
  "error.voice.cloud.keyRejected":
    "ElevenLabs non ha accettato la chiave API. Controlla la chiave in Impostazioni → Voce.",
  "error.voice.cloud.quotaExceeded": "La tua quota di ElevenLabs è esaurita.",
  "error.voice.cloud.rateLimited": "ElevenLabs è occupato. Riprova tra poco.",
  "error.voice.cloud.termsRequired": "Accetta i termini di ElevenLabs nel tuo account ElevenLabs, poi riprova.",
  "error.voice.cloud.streamEnded": "Lo stream della dettatura è terminato. Registra di nuovo.",
  "error.voice.cloud.tooLong": "La registrazione è troppo lunga.",
  "error.voice.cloud.keySaveFailed": "Impossibile salvare la chiave API di ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "La sintesi vocale locale non è disponibile su questa piattaforma.",
  "error.voice.speech.modelRequired": "Scarica il modello di sintesi vocale in Impostazioni → Voce.",
  "error.voice.speech.timedOut": "La lettura ad alta voce della risposta è scaduta.",
  "error.voice.speech.failed": "OpenBot non è riuscito a leggere la risposta ad alta voce.",
  "error.voice.recordingNotKept": "OpenBot non è riuscito a conservare la registrazione vocale.",
} as const satisfies PartialTranslation<typeof source>;
