import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld":
    "Dieser Server unterstützt das CRM nicht. Aktualisiere OpenBot auf dem Computer, auf dem er läuft.",
  "error.crm.tooLargeToSend": "Diese CRM-Seite ist zu groß, um sie an diesen Client zu senden.",
  "error.crm.customerMissing": "Diesen Kunden gibt es nicht mehr.",
  "error.crm.planMissing": "Diesen Tarif gibt es nicht mehr.",
  "error.crm.paymentMissing": "Diese Zahlung gibt es nicht mehr.",
  "error.crm.tagMissing": "Dieses Tag gibt es nicht mehr.",
  "error.crm.statusMissing": "Diesen Status gibt es nicht mehr.",
  "error.crm.proposalMissing": "Diesen Vorschlag gibt es nicht mehr, oder er wurde bereits entschieden.",
  "error.crm.tagExists": "Es gibt bereits ein Tag mit diesem Namen.",
  "error.crm.statusExists": "Es gibt bereits einen Status mit diesem Namen.",
  "error.crm.builtinStatus": "Einen integrierten Status kannst du nicht umbenennen oder löschen.",
  "error.crm.tooManyStatuses": "Das CRM hat die maximale Anzahl an Status. Lösche zuerst einen Status.",
  "error.crm.tooManyTags": "Das CRM hat die maximale Anzahl an Tags. Lösche zuerst ein Tag.",
  "error.crm.tooManyPlans": "Dieser Kunde hat die maximale Anzahl an Tarifen. Lösche zuerst einen Tarif.",
  "error.crm.paymentPaid": "Diese Zahlung ist bezahlt. Markiere sie zuerst als nicht bezahlt.",
  "error.crm.splitTotal": "Die Teile müssen zusammen den Betrag der Zahlung ergeben.",
  "error.crm.planEndsBeforeStart": "Ein Tarif kann nicht vor seinem Beginn enden.",
  "error.crm.currencyInUse": "Die Währung eines Kunden mit Tarifen oder Zahlungen kannst du nicht ändern.",
  "error.crm.badCursor": "Diese Seite ist nicht mehr gültig. Lade die Liste neu.",
  "error.crm.invalidChange": "Diese Änderung ist nicht gültig.",
  "error.crm.agentNotAllowed":
    "Dieser Agent kann das CRM nicht nutzen. Ein Eigentümer oder Administrator kann ihn zulassen: CRM-Seite öffnen, auf Vorschläge klicken, auf die Schaltfläche mit der Anzahl der Agenten klicken und diesen Agenten einschalten.",
  "error.crm.tooManyProposals":
    "Zu viele Vorschläge warten auf eine Entscheidung. Warte, bis eine Person darüber entscheidet.",
  "error.crm.amountInvalid": "Gib den Betrag als Zahl ein, zum Beispiel 129.00.",
  "error.crm.amountDecimals": "Der Betrag hat zu viele Nachkommastellen für {currency}.",
  "error.crm.fieldPrivate": "Dieses Feld ist privat. Agenten können es nicht lesen und nicht danach filtern.",
  "error.crm.sourceOwned":
    "Stripe verwaltet diese Zeile. Ändere sie in Stripe; das CRM übernimmt die Änderung bei der nächsten Synchronisierung.",
  "error.crm.sourceConnected": "Stripe ist bereits mit diesem CRM verbunden.",
  "error.crm.sourceMissing": "Diese Stripe-Verbindung existiert nicht mehr.",
  "error.crm.sourceSecretKey":
    "Das ist ein geheimer Schlüssel, der dein Stripe-Konto ändern kann. Erstelle einen eingeschränkten Schlüssel nur mit Lesezugriff.",
  "error.crm.sourceInvalidKey":
    "Stripe akzeptiert diesen Schlüssel nicht. Kopiere den eingeschränkten Schlüssel noch einmal.",
  "error.crm.sourcePermission":
    "Dieser Schlüssel kann keine Kunden, Rechnungen, Abonnements, Ereignisse und Produkte lesen. Gib ihm Lesezugriff darauf.",
  "error.crm.sourceRateLimited": "Stripe hat zu viele Anfragen erhalten. Versuche es in einer Minute noch einmal.",
  "error.crm.sourceNetwork": "OpenBot kann keine Verbindung zu Stripe herstellen. Prüfe die Internetverbindung.",
  "error.crm.sourceFailed":
    "Stripe hat eine Antwort gesendet, die OpenBot nicht lesen kann. Versuche es später noch einmal.",
  "error.crm.sourceKeySaveFailed": "OpenBot kann den Stripe-Schlüssel nicht auf diesem Computer speichern.",
  "error.crm.off":
    "Das CRM ist aus. Ein Eigentümer oder Admin kann es unter Servereinstellungen > Experimentell einschalten.",
  "error.crm.settingsSaveFailed": "OpenBot kann die CRM-Einstellung auf diesem Server nicht speichern.",
} as const satisfies PartialTranslation<typeof source>;
