import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Anuluj",
  "common.save": "Zapisz",
  "common.close": "Zamknij",
  "common.delete": "Usuń",
  "common.remove": "Usuń",
  "common.edit": "Edytuj",
  "common.rename": "Zmień nazwę",
  "common.retry": "Spróbuj ponownie",
  "common.copy": "Kopiuj",
  "common.copied": "Skopiowano",
  "common.done": "Gotowe",
  "common.back": "Wstecz",
  "common.continue": "Dalej",
  "common.add": "Dodaj",
  "common.create": "Utwórz",
  "common.open": "Otwórz",
  "common.search": "Szukaj",
  "common.loading": "Wczytywanie…",
  "common.saving": "Zapisywanie…",
  "common.tryAgain": "Spróbuj ponownie",
  "common.connecting": "Łączenie…",
  "common.download": "Pobierz",
  "common.removing": "Usuwanie…",
  "common.sending": "Wysyłanie…",
} as const satisfies PartialTranslation<typeof source>;
