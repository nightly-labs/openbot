import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Nie udało się pobrać modelu głosowego. Spróbuj ponownie.",
  "error.voice.downloadStopped": "Pobieranie modelu głosowego zostało zatrzymane.",
  "error.voice.runtimeUnavailable": "Lokalna transkrypcja głosu nie jest dostępna na tej platformie.",
  "error.voice.busy": "Transkrypcja głosu już trwa.",
  "error.voice.modelUnavailable": "Model głosowy jest niedostępny.",
  "error.voice.transcriptionTimedOut": "Przekroczono limit czasu transkrypcji głosu.",
  "error.voice.prepareRequired":
    "Lokalna transkrypcja głosu jest niedostępna. Uruchom `bun run voice:prepare` i uruchom ponownie OpenBot.",
  "error.voice.transcriptionFailed": "Nie udało się przetranskrybować tego nagrania.",
} as const satisfies PartialTranslation<typeof source>;
