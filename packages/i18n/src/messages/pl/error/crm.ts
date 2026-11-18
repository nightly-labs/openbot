import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Ten serwer nie obsługuje CRM. Zaktualizuj OpenBot na komputerze, na którym działa.",
  "error.crm.tooLargeToSend": "Ta strona CRM jest za duża, aby wysłać ją do tej aplikacji.",
  "error.crm.customerMissing": "Ten klient już nie istnieje.",
  "error.crm.planMissing": "Ten plan już nie istnieje.",
  "error.crm.paymentMissing": "Ta płatność już nie istnieje.",
  "error.crm.tagMissing": "Ten tag już nie istnieje.",
  "error.crm.statusMissing": "Ten status już nie istnieje.",
  "error.crm.proposalMissing": "Ta propozycja już nie istnieje lub została już rozpatrzona.",
  "error.crm.tagExists": "Tag o tej nazwie już istnieje.",
  "error.crm.statusExists": "Status o tej nazwie już istnieje.",
  "error.crm.builtinStatus": "Nie możesz zmienić nazwy ani usunąć wbudowanego statusu.",
  "error.crm.tooManyStatuses": "CRM ma już maksymalną liczbę statusów. Najpierw usuń jakiś status.",
  "error.crm.tooManyTags": "CRM ma już maksymalną liczbę tagów. Najpierw usuń jakiś tag.",
  "error.crm.tooManyPlans": "Ten klient ma już maksymalną liczbę planów. Najpierw usuń jakiś plan.",
  "error.crm.paymentPaid": "Ta płatność jest opłacona. Najpierw oznacz ją jako nieopłaconą.",
  "error.crm.splitTotal": "Suma części musi być równa kwocie płatności.",
  "error.crm.planEndsBeforeStart": "Plan nie może się skończyć przed rozpoczęciem.",
  "error.crm.currencyInUse": "Nie możesz zmienić waluty klienta, który ma plany lub płatności.",
  "error.crm.badCursor": "Ta strona jest już nieaktualna. Wczytaj listę ponownie.",
  "error.crm.invalidChange": "Ta zmiana jest nieprawidłowa.",
  "error.crm.agentNotAllowed":
    "Ten agent nie może korzystać z CRM. Właściciel lub administrator może mu na to pozwolić: otwórz stronę CRM, kliknij Sugestie, kliknij przycisk z liczbą agentów i włącz tego agenta.",
  "error.crm.tooManyProposals": "Zbyt wiele propozycji czeka na decyzję. Poczekaj, aż ktoś je rozpatrzy.",
  "error.crm.amountInvalid": "Wpisz kwotę jako liczbę, na przykład 129.00.",
  "error.crm.amountDecimals": "Kwota ma za dużo miejsc po przecinku dla {currency}.",
  "error.crm.fieldPrivate": "To pole jest prywatne. Agenci nie mogą go odczytać ani według niego filtrować.",
  "error.crm.sourceOwned":
    "Stripe zarządza tym wierszem. Zmień go w Stripe; CRM pobierze zmianę przy następnej synchronizacji.",
  "error.crm.sourceConnected": "Stripe jest już połączony z tym CRM.",
  "error.crm.sourceMissing": "To połączenie ze Stripe już nie istnieje.",
  "error.crm.sourceSecretKey":
    "To klucz tajny, który może zmieniać Twoje konto Stripe. Utwórz klucz z ograniczeniami tylko z dostępem do odczytu.",
  "error.crm.sourceInvalidKey": "Stripe nie akceptuje tego klucza. Skopiuj klucz z ograniczeniami jeszcze raz.",
  "error.crm.sourcePermission":
    "Ten klucz nie może odczytać klientów, faktur, subskrypcji, zdarzeń i produktów. Nadaj mu do nich dostęp do odczytu.",
  "error.crm.sourceRateLimited": "Stripe dostał zbyt wiele żądań. Spróbuj ponownie za minutę.",
  "error.crm.sourceNetwork": "OpenBot nie może połączyć się ze Stripe. Sprawdź połączenie z internetem.",
  "error.crm.sourceFailed": "Stripe wysłał odpowiedź, której OpenBot nie może odczytać. Spróbuj ponownie później.",
  "error.crm.sourceKeySaveFailed": "OpenBot nie może zapisać klucza Stripe na tym komputerze.",
  "error.crm.off":
    "CRM jest wyłączony. Właściciel lub administrator może go włączyć w Ustawieniach serwera > Eksperymentalne.",
  "error.crm.settingsSaveFailed": "OpenBot nie może zapisać ustawienia CRM na tym serwerze.",
} as const satisfies PartialTranslation<typeof source>;
