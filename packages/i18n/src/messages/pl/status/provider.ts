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
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude odpowiedział ze standardową szybkością. Z subskrypcją Claude tryb szybki korzysta ze środków na użycie. Włącz je na koncie Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude odpowiedział ze standardową szybkością. Twój plan Claude nie obejmuje trybu szybkiego.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude odpowiedział ze standardową szybkością. Tryb szybki działa tylko z kluczem API Anthropic lub subskrypcją Claude, nie z Bedrock, Vertex, Foundry ani bramą.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude odpowiedział ze standardową szybkością. Ten model nie może używać trybu szybkiego na Twoim koncie.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude odpowiedział ze standardową szybkością. Tryb szybki jest wyłączony w ustawieniach Claude Code lub przez Twoją organizację.",
  "status.provider.claudeFastModeUnavailable":
    "Claude odpowiedział ze standardową szybkością. Claude Code nie mógł użyć trybu szybkiego w tej turze.",
} as const satisfies PartialTranslation<typeof source>;
