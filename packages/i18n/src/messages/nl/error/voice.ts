import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Kan het spraakmodel niet downloaden. Probeer het opnieuw.",
  "error.voice.downloadStopped": "De download van het spraakmodel is gestopt.",
  "error.voice.removeBusy": "Wacht tot de spraaktranscriptie klaar is en verwijder dan het model.",
  "error.voice.removeFailed": "Kan het spraakmodel niet verwijderen. Probeer het opnieuw.",
  "error.voice.runtimeUnavailable": "Lokale spraaktranscriptie is niet beschikbaar op dit platform.",
  "error.voice.busy": "Er loopt al een spraaktranscriptie.",
  "error.voice.modelUnavailable": "Het spraakmodel is niet beschikbaar.",
  "error.voice.transcriptionTimedOut": "De spraaktranscriptie duurde te lang.",
  "error.voice.prepareRequired":
    "Lokale spraaktranscriptie is niet beschikbaar. Voer `bun run voice:prepare` uit en start OpenBot opnieuw.",
  "error.voice.transcriptionFailed": "OpenBot kon deze opname niet transcriberen.",
  "error.voice.cloud.keyRequired": "Voeg je ElevenLabs-API-sleutel toe in Instellingen → Spraak.",
  "error.voice.cloud.keyRejected":
    "ElevenLabs heeft de API-sleutel niet geaccepteerd. Controleer de sleutel in Instellingen → Spraak.",
  "error.voice.cloud.quotaExceeded": "Je ElevenLabs-tegoed is op.",
  "error.voice.cloud.rateLimited": "ElevenLabs is bezet. Probeer het zo opnieuw.",
  "error.voice.cloud.termsRequired":
    "Accepteer de voorwaarden van ElevenLabs in je ElevenLabs-account en probeer het opnieuw.",
  "error.voice.cloud.streamEnded": "De dicteerstream is beëindigd. Neem opnieuw op.",
  "error.voice.cloud.tooLong": "De opname is te lang.",
  "error.voice.cloud.keySaveFailed": "Kan de ElevenLabs-API-sleutel niet opslaan.",
  "error.voice.speech.runtimeUnavailable": "Lokale spraakuitvoer is niet beschikbaar op dit platform.",
  "error.voice.speech.modelRequired": "Download het spraakuitvoermodel in Instellingen → Spraak.",
  "error.voice.speech.timedOut": "Het voorlezen van het antwoord duurde te lang.",
  "error.voice.speech.failed": "OpenBot kon het antwoord niet voorlezen.",
  "error.voice.recordingNotKept": "OpenBot kon de spraakopname niet bewaren.",
} as const satisfies PartialTranslation<typeof source>;
