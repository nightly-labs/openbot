import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "Het abonnement van de server kon niet worden gewijzigd. Vernieuw Facturering en probeer het opnieuw.",
  "error.billing.confirmMismatch": "Typ de naam van de server om hem te verwijderen.",
  "error.billing.restartBusy": "De server kan nu niet herstarten. Probeer het over een minuut opnieuw.",
  "error.billing.planRequired": "Het abonnement van deze server is afgelopen. Verleng het om de server te starten.",
  "error.billing.planSoldOut": "Dit abonnement is uitverkocht. Kies een ander abonnement.",
  "error.billing.licenseExists": "Dit account heeft al een licentie. Wijzig in plaats daarvan de gebruikers.",
  "error.billing.licenseCurrency": "De licentie moet de valuta van je andere abonnementen gebruiken.",
  "error.billing.licenseUsersInUse":
    "De licentie kan niet minder gebruikers hebben dan het aantal mensen dat hem nu gebruikt.",
  "error.billing.licensePaymentFailed":
    "De betaling voor de toegevoegde gebruikers is mislukt. Werk de betaalmethode bij en probeer het opnieuw.",
  "error.billing.licenseUnavailable": "Licenties zijn nu niet beschikbaar.",
  "error.billing.noLicense": "Dit account heeft geen licentie.",
  "error.billing.invalidRequest": "Het factureringsverzoek is ongeldig.",
  "error.billing.invalidResponse": "Het factureringsantwoord is ongeldig.",
  "error.billing.notStripePage": "De factureringspagina is geen Stripe-pagina.",
} as const satisfies PartialTranslation<typeof source>;
