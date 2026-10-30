import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Zaloguj się, aby udostępnić",
  "mobile.share.signInDescription":
    "Zeskanuj kod QR w OpenBot na komputerze. Potem możesz wybrać agenta, który otrzyma udostępnioną treść.",
  "mobile.share.reading": "Odczytywanie udostępnionej treści…",
  "mobile.share.readFailed": "OpenBot nie może odczytać udostępnionej treści. Udostępnij ją ponownie.",
  "mobile.share.content": "Do udostępnienia",
  "mobile.share.footer":
    "Czat otworzy się z tą treścią w polu wiadomości. Nic nie zostanie wysłane, dopóki jej nie wyślesz.",
  "mobile.share.lastUsed": "Ostatnio używany",
  "mobile.share.noAgents": "Brak agentów",
  "mobile.share.chooseAgent": "Wybierz agenta",
  "mobile.share.action": "Udostępnij: {name}",
  "mobile.share.extension.send": "Wyślij",
  "mobile.share.extension.footer": "OpenBot wyśle to teraz do agenta. Aplikacja się nie otworzy.",
  "mobile.share.extension.sending": "Wysyłanie do {name}…",
  "mobile.share.extension.sent": "Wysłano do {name}",
  "mobile.share.extension.failed": "OpenBot nie mógł tego wysłać. Otwórz aplikację, aby wysłać to z niej.",
  "mobile.share.extension.unconfirmed": "Serwer nie potwierdził wiadomości. Sprawdź czat, zanim wyślesz ją ponownie.",
  "mobile.share.extension.openApp": "Otwórz OpenBot",
} as const satisfies PartialTranslation<typeof source>;
