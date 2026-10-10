import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Nie udało się zmienić planu serwera. Odśwież Rozliczenia i spróbuj ponownie.",
  "error.billing.confirmMismatch": "Wpisz nazwę serwera, aby go usunąć.",
  "error.billing.invalidRequest": "Żądanie rozliczeniowe jest nieprawidłowe.",
  "error.billing.invalidResponse": "Odpowiedź rozliczeniowa jest nieprawidłowa.",
  "error.billing.notStripePage": "Strona rozliczeń nie jest stroną Stripe.",
} as const satisfies PartialTranslation<typeof source>;
