import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Pobieranie zatrzymane. Spróbuj ponownie.",
  "status.provider.downloadFailed": "Pobieranie nie powiodło się. Spróbuj ponownie.",
  "status.provider.updateWaiting": "Aktualizacja zacznie się po zakończeniu bieżącej tury.",
  "status.provider.confirmContinue": "Kontynuuj",
  "status.provider.confirmCancel": "Anuluj",
  "status.provider.retryUnreachable":
    "{provider} nie może połączyć się ze swoim serwerem. Ponowienie {attempt} z {maxAttempts}.",
  "status.provider.retryServerError":
    "Serwer {provider} jest zajęty lub zwrócił błąd. Ponowienie {attempt} z {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} znów otrzymuje odpowiedzi ze swojego serwera.",
} as const satisfies PartialTranslation<typeof source>;
