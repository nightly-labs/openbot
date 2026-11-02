import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Nie udało się zmienić planu serwera. Odśwież Rozliczenia i spróbuj ponownie.",
  "error.billing.confirmMismatch": "Wpisz nazwę serwera, aby go usunąć.",
  "error.billing.restartBusy": "Serwera nie można teraz uruchomić ponownie. Spróbuj ponownie za minutę.",
  "error.billing.planRequired": "Plan tego serwera się skończył. Odnów go, aby uruchomić serwer.",
  "error.billing.planSoldOut": "Ten plan jest wyprzedany. Wybierz inny plan.",
  "error.billing.licenseExists": "To konto ma już licencję. Zamiast tego zmień liczbę jej użytkowników.",
  "error.billing.licenseCurrency": "Licencja musi używać waluty Twoich innych planów.",
  "error.billing.planCurrency": "Nowy plan musi używać waluty Twoich innych planów.",
  "error.billing.licenseUsersInUse":
    "Licencja nie może mieć mniej użytkowników niż osób, które teraz z niej korzystają.",
  "error.billing.licensePaymentFailed":
    "Płatność za dodanych użytkowników nie powiodła się. Zaktualizuj metodę płatności i spróbuj ponownie.",
  "error.billing.licenseUnavailable": "Licencje są teraz niedostępne.",
  "error.billing.licenseOneUser": "Ta licencja obejmuje 1 użytkownika. Zmień ją na Team, aby dodać użytkowników.",
  "error.billing.licensePlanChange": "Tej licencji nie można zmienić na ten plan. Anuluj ją i kup nowy plan.",
  "error.billing.noLicense": "To konto nie ma licencji.",
  "error.billing.invalidRequest": "Żądanie rozliczeniowe jest nieprawidłowe.",
  "error.billing.invalidResponse": "Odpowiedź rozliczeniowa jest nieprawidłowa.",
  "error.billing.notStripePage": "Strona rozliczeń nie jest stroną Stripe.",
} as const satisfies PartialTranslation<typeof source>;
