import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "Het abonnement van de server kon niet worden gewijzigd. Vernieuw Facturering en probeer het opnieuw.",
  "error.billing.confirmMismatch": "Typ de naam van de server om hem te verwijderen.",
  "error.billing.restartBusy": "De server kan nu niet herstarten. Probeer het over een minuut opnieuw.",
  "error.billing.restartUnavailable": "Deze server kan niet vanaf hier herstarten. Neem contact op met support.",
  "error.billing.planRequired": "Het abonnement van deze server is afgelopen. Verleng het om de server te starten.",
  "error.billing.planSoldOut": "Dit abonnement is uitverkocht. Kies een ander abonnement.",
  "error.billing.storageUnavailable": "Deze opslag is niet beschikbaar voor deze server.",
  "error.billing.storagePaymentFailed":
    "De betaling voor de opslag is mislukt. Werk de betaalmethode bij en probeer het opnieuw.",
  "error.billing.licenseExists": "Dit account heeft al een licentie. Wijzig in plaats daarvan de gebruikers.",
  "error.billing.licenseCurrency": "De licentie moet de valuta van je andere abonnementen gebruiken.",
  "error.billing.licenseUsersInUse":
    "De licentie kan niet minder gebruikers hebben dan het aantal mensen dat hem nu gebruikt.",
  "error.billing.licensePaymentFailed":
    "De betaling voor de toegevoegde gebruikers is mislukt. Werk de betaalmethode bij en probeer het opnieuw.",
  "error.billing.licenseUnavailable": "Licenties zijn nu niet beschikbaar.",
  "error.billing.noLicense": "Dit account heeft geen licentie.",
  "error.billing.countryRequired":
    "Geef je factuurland op voordat je betaalt. Werk OpenBot bij om dit te doen en probeer het opnieuw.",
  "error.billing.detailsInvalid":
    "Controleer het land en het btw-nummer. Het btw-nummer moet bij het gekozen land horen.",
  "error.billing.vatIdInvalid":
    "Het btw-systeem van de EU kent dit btw-nummer niet. Controleer het nummer of ga verder zonder btw-nummer.",
  "error.billing.vatIdUnverified":
    "Het btw-systeem van de EU kan het btw-nummer nu niet controleren. Probeer het later opnieuw of ga verder zonder btw-nummer.",
  "error.billing.vatUnavailable": "Betalen is nu niet mogelijk. Probeer het later opnieuw.",
  "error.billing.invalidRequest": "Het factureringsverzoek is ongeldig.",
  "error.billing.invalidResponse": "Het factureringsantwoord is ongeldig.",
  "error.billing.notStripePage": "De factureringspagina is geen Stripe-pagina.",
  "error.billing.customServerOfferMissing": "Deze server heeft geen abonnement om te betalen.",
} as const satisfies PartialTranslation<typeof source>;
