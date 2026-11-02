import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "Deze computer heeft geen opslag voor geheimen, dus de Kluis kan geen items opslaan.",
  "error.vault.unreadable": "Het bestand van de Kluis is onleesbaar. Zet de Kluis terug om hem weer te gebruiken.",
  "error.vault.tooLarge": "De Kluis is vol. Verwijder een paar items en probeer het opnieuw.",
  "error.vault.itemMissing": "Dit item staat niet meer in de Kluis.",
  "error.vault.valueTooLong": "Een waarde is te lang.",
  "error.vault.websiteInvalid": "Voer een HTTPS-websiteadres in.",
  "error.vault.passwordRequired": "Voer een wachtwoord in.",
  "error.vault.cardNumberInvalid": "Voer een geldig kaartnummer in.",
  "error.vault.securityCodeInvalid": "Voer een beveiligingscode van 3 of 4 cijfers in.",
  "error.vault.expiryInvalid": "Voer een geldige vervalmaand en vervaljaar in.",
  "error.vault.contactEmpty": "Voer een naam, adres, telefoonnummer of e-mailadres in.",
  "error.vault.contactMissing": "Het factuurcontact staat niet meer in de Kluis.",
  "error.vault.csvInvalid": "Dit bestand is geen wachtwoordexport in CSV-indeling.",
  "error.vault.csvTooLarge": "Het CSV-bestand is te groot.",
} as const satisfies PartialTranslation<typeof source>;
