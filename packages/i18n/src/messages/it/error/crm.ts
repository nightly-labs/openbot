import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Questo server non supporta il CRM. Aggiorna OpenBot sul computer che lo esegue.",
  "error.crm.tooLargeToSend": "Questa pagina del CRM è troppo grande per essere inviata a questa app.",
  "error.crm.customerMissing": "Questo cliente non esiste più.",
  "error.crm.planMissing": "Questo piano non esiste più.",
  "error.crm.paymentMissing": "Questo pagamento non esiste più.",
  "error.crm.tagMissing": "Questo tag non esiste più.",
  "error.crm.statusMissing": "Questo stato non esiste più.",
  "error.crm.proposalMissing": "Questo suggerimento non esiste più o è già stato deciso.",
  "error.crm.tagExists": "Esiste già un tag con questo nome.",
  "error.crm.statusExists": "Esiste già uno stato con questo nome.",
  "error.crm.builtinStatus": "Non puoi rinominare o eliminare uno stato predefinito.",
  "error.crm.tooManyStatuses": "Il CRM ha già il numero massimo di stati. Elimina prima uno stato.",
  "error.crm.tooManyTags": "Il CRM ha già il numero massimo di tag. Elimina prima un tag.",
  "error.crm.tooManyPlans": "Questo cliente ha già il numero massimo di piani. Elimina prima un piano.",
  "error.crm.paymentPaid": "Questo pagamento risulta pagato. Contrassegnalo prima come non pagato.",
  "error.crm.splitTotal": "La somma delle parti deve essere uguale all'importo del pagamento.",
  "error.crm.planEndsBeforeStart": "Un piano non può terminare prima di iniziare.",
  "error.crm.currencyInUse": "Non puoi cambiare la valuta di un cliente che ha piani o pagamenti.",
  "error.crm.badCursor": "Questa pagina non è più valida. Ricarica l'elenco.",
  "error.crm.invalidChange": "Questa modifica non è valida.",
  "error.crm.agentNotAllowed":
    "Questo agente non può usare il CRM. Un proprietario o un amministratore può dargli l'accesso: apri la pagina del CRM, fai clic su Suggerimenti, fai clic sul pulsante con il numero di agenti e attiva questo agente.",
  "error.crm.tooManyProposals": "Troppi suggerimenti attendono una decisione. Attendi che una persona li valuti.",
  "error.crm.amountInvalid": "Scrivi l'importo come numero, ad esempio 129.00.",
  "error.crm.amountDecimals": "L'importo ha troppe cifre decimali per {currency}.",
  "error.crm.fieldPrivate": "Questo campo è privato. Gli agenti non possono leggerlo né filtrare in base a esso.",
  "error.crm.sourceOwned":
    "Stripe gestisce questa riga. Modificala in Stripe; il CRM riceve la modifica alla prossima sincronizzazione.",
  "error.crm.sourceConnected": "Stripe è già collegato a questo CRM.",
  "error.crm.sourceMissing": "Questa connessione Stripe non esiste più.",
  "error.crm.sourceSecretKey":
    "Questa è una chiave segreta, che può modificare il tuo account Stripe. Crea una chiave limitata con solo accesso in lettura.",
  "error.crm.sourceInvalidKey": "Stripe non accetta questa chiave. Copia di nuovo la chiave limitata.",
  "error.crm.sourcePermission":
    "Questa chiave non può leggere clienti, fatture, abbonamenti, eventi e prodotti. Dalle l'accesso in lettura.",
  "error.crm.sourceRateLimited": "Stripe ha ricevuto troppe richieste. Riprova tra un minuto.",
  "error.crm.sourceNetwork": "OpenBot non riesce a connettersi a Stripe. Controlla la connessione a internet.",
  "error.crm.sourceFailed": "Stripe ha inviato una risposta che OpenBot non riesce a leggere. Riprova più tardi.",
  "error.crm.sourceKeySaveFailed": "OpenBot non riesce a salvare la chiave di Stripe su questo computer.",
  "error.crm.off":
    "Il CRM è disattivato. Un proprietario o un amministratore può attivarlo in Impostazioni server > Sperimentale.",
  "error.crm.settingsSaveFailed": "OpenBot non può salvare l’impostazione del CRM su questo server.",
} as const satisfies PartialTranslation<typeof source>;
