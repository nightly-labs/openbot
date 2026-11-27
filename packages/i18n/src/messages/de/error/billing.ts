import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed":
    "Der Servertarif konnte nicht geändert werden. Lade „Abrechnung“ neu und versuche es erneut.",
  "error.billing.confirmMismatch": "Gib den Servernamen ein, um ihn zu löschen.",
  "error.billing.restartBusy": "Der Server kann jetzt nicht neu starten. Versuche es in einer Minute erneut.",
  "error.billing.restartUnavailable": "Dieser Server kann von hier aus nicht neu starten. Wende dich an den Support.",
  "error.billing.planRequired": "Der Tarif dieses Servers ist abgelaufen. Verlängere ihn, um den Server zu starten.",
  "error.billing.planSoldOut": "Dieser Tarif ist ausverkauft. Wähle einen anderen Tarif.",
  "error.billing.storageUnavailable": "Dieser Speicher ist für diesen Server nicht verfügbar.",
  "error.billing.storagePaymentFailed":
    "Die Zahlung für den Speicher ist fehlgeschlagen. Aktualisiere die Zahlungsmethode und versuche es erneut.",
  "error.billing.licenseExists": "Dieses Konto hat bereits eine Lizenz. Ändern Sie stattdessen ihre Nutzerzahl.",
  "error.billing.licenseCurrency": "Die Lizenz muss die Währung Ihrer anderen Pläne verwenden.",
  "error.billing.planCurrency": "Ein neuer Plan muss die Währung Ihrer anderen Pläne verwenden.",
  "error.billing.licenseUsersInUse":
    "Die Lizenz kann nicht weniger Nutzer haben als die Personen, die sie jetzt nutzen.",
  "error.billing.licensePaymentFailed":
    "Die Zahlung für die zusätzlichen Nutzer ist fehlgeschlagen. Aktualisieren Sie die Zahlungsmethode und versuchen Sie es erneut.",
  "error.billing.licenseUnavailable": "Lizenzen sind derzeit nicht verfügbar.",
  "error.billing.mediaContentRefused":
    "Die Sicherheitsprüfung des Modells hat den Prompt oder die Bilder abgelehnt. Sie lehnt oft echte Personen, bekannte Figuren, Marken, Gewalt und Inhalte für Erwachsene ab. Ändere sie und versuche es erneut. Es wurden keine Credits verbraucht.",
  "error.billing.licenseOneUser": "Diese Lizenz gilt für 1 Nutzer. Wechsle zu Team, um Nutzer hinzuzufügen.",
  "error.billing.licensePlanChange":
    "Diese Lizenz kann nicht zu diesem Tarif wechseln. Kündige sie und kaufe den neuen Tarif.",
  "error.billing.noLicense": "Dieses Konto hat keine Lizenz.",
  "error.billing.countryRequired":
    "Gib vor der Zahlung dein Rechnungsland an. Aktualisiere dazu OpenBot und versuche es erneut.",
  "error.billing.detailsInvalid": "Prüfe das Land und die USt-IdNr. Die USt-IdNr. muss zum gewählten Land gehören.",
  "error.billing.vatIdInvalid":
    "Das EU-Mehrwertsteuersystem kennt diese USt-IdNr. nicht. Prüfe die Nummer oder fahre ohne USt-IdNr. fort.",
  "error.billing.vatUnavailable": "Die Zahlung ist gerade nicht verfügbar. Versuche es später erneut.",
  "error.billing.invalidRequest": "Die Abrechnungsanfrage ist ungültig.",
  "error.billing.invalidResponse": "Die Abrechnungsantwort ist ungültig.",
  "error.billing.notStripePage": "Die Abrechnungsseite ist keine Stripe-Seite.",
  "error.billing.customServerOfferMissing": "Für diesen Server gibt es keinen Tarif zum Bezahlen.",
  "error.billing.checkoutUnavailable": "Die Zahlung kann gerade nicht starten. Versuche es in einer Minute erneut.",
} as const satisfies PartialTranslation<typeof source>;
