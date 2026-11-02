import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Nie udało się pobrać modelu głosowego. Spróbuj ponownie.",
  "error.voice.downloadStopped": "Pobieranie modelu głosowego zostało zatrzymane.",
  "error.voice.removeBusy": "Poczekaj na koniec transkrypcji głosu, a potem usuń model.",
  "error.voice.removeFailed": "Nie udało się usunąć modelu głosowego. Spróbuj ponownie.",
  "error.voice.runtimeUnavailable": "Lokalna transkrypcja głosu nie jest dostępna na tej platformie.",
  "error.voice.busy": "Transkrypcja głosu już trwa.",
  "error.voice.modelUnavailable": "Model głosowy jest niedostępny.",
  "error.voice.transcriptionTimedOut": "Przekroczono limit czasu transkrypcji głosu.",
  "error.voice.prepareRequired":
    "Lokalna transkrypcja głosu jest niedostępna. Uruchom `bun run voice:prepare` i uruchom ponownie OpenBot.",
  "error.voice.transcriptionFailed": "Nie udało się przetranskrybować tego nagrania.",
  "error.voice.cloud.keyRequired": "Dodaj klucz API ElevenLabs w sekcji Ustawienia → Głos.",
  "error.voice.cloud.keyRejected": "ElevenLabs nie zaakceptował klucza API. Sprawdź klucz w sekcji Ustawienia → Głos.",
  "error.voice.cloud.quotaExceeded": "Limit ElevenLabs został wyczerpany.",
  "error.voice.cloud.rateLimited": "ElevenLabs jest zajęty. Spróbuj ponownie za chwilę.",
  "error.voice.cloud.termsRequired": "Zaakceptuj warunki ElevenLabs na swoim koncie ElevenLabs i spróbuj ponownie.",
  "error.voice.cloud.streamEnded": "Przesyłanie dyktowania zostało przerwane. Nagraj ponownie.",
  "error.voice.cloud.tooLong": "Nagranie jest za długie.",
  "error.voice.cloud.keySaveFailed": "Nie udało się zapisać klucza API ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "Lokalna synteza mowy nie jest dostępna na tej platformie.",
  "error.voice.speech.modelRequired": "Pobierz model syntezy mowy w Ustawienia → Głos.",
  "error.voice.speech.timedOut": "Czytanie odpowiedzi na głos trwało zbyt długo.",
  "error.voice.speech.failed": "OpenBot nie mógł przeczytać odpowiedzi na głos.",
  "error.voice.recordingNotKept": "OpenBot nie mógł zachować nagrania głosowego.",
} as const satisfies PartialTranslation<typeof source>;
