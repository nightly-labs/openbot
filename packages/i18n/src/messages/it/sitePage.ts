import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Impossibile caricare questa pagina",
  "sitePage.error.body":
    "Controlla la connessione e ricarica la pagina. Se ancora non si carica, torna alla pagina iniziale.",
  "sitePage.error.reload": "Ricarica pagina",
  "sitePage.error.home": "Torna alla home",
  "sitePage.join.title": "Unisciti a un server OpenBot",
  "sitePage.join.description": "Apri un invito privato a un server in OpenBot.",
  "sitePage.join.eyebrow": "Invito privato",
  "sitePage.join.intro":
    "Apri questo invito in OpenBot. L’app controlla il server e ti chiede di confermare prima di connettersi.",
  "sitePage.join.invalid":
    "Questo link di invito non è valido o non è completo. Chiedi un nuovo invito al proprietario del server.",
  "sitePage.join.open": "Apri OpenBot",
  "sitePage.join.browser": "Apri nel browser",
  "sitePage.join.download": "Scarica OpenBot",
  "sitePage.join.notOpened":
    "Se OpenBot non si è aperto, installalo con {download}, oppure avvia OpenBot una volta perché possa aprire i link di invito. Puoi anche usare {browser}.",
  "sitePage.join.mobile":
    "Se OpenBot è installato, tocca {open}. Puoi anche incollare questo link in Aggiungi server nell’app.",
  "sitePage.join.singleUse":
    "Un link monouso funziona una volta e poi scade. Un link permanente funziona finché il proprietario non lo revoca. OpenBot mostra la scadenza prima che tu entri.",
  "sitePage.join.email": "Se l’invito è arrivato via email, accedi a OpenBot con quell’indirizzo email.",
  "sitePage.join.share": "Questo link dà accesso a un server. Condividilo solo con le persone che vuoi invitare.",
  "sitePage.connect.title": "Torna a OpenBot",
  "sitePage.connect.failedTitle": "La connessione non è stata completata",
  "sitePage.connect.openApp": "Apri OpenBot",
  "sitePage.connect.tryAgainApp": "Riprova in OpenBot",
  "sitePage.connect.tryAgainBrowser": "Riprova nel browser",
  "sitePage.connect.doneInWebClient":
    "La tua scheda di OpenBot completa la connessione a {name}. Puoi chiudere questa scheda.",
  "sitePage.connect.doneInApp": "OpenBot completa la connessione a {name} sul tuo computer.",
  "sitePage.connect.failure.cancelled": "La connessione a {name} è stata annullata. Non è cambiato nulla.",
  "sitePage.connect.failure.expired": "L’accesso a {name} è scaduto. Avvia di nuovo la connessione.",
  "sitePage.connect.failure.exchange": "{name} non ha confermato la connessione. Riprova.",
  "sitePage.connect.failure.enterprise": "Connetti un workspace Slack, non un’intera organizzazione.",
  "sitePage.connect.failure.takenSlack":
    "Un altro server OpenBot risponde già in questo workspace Slack. Disconnettilo su quel server, poi riprova.",
  "sitePage.connect.failure.takenDiscord":
    "Un altro server OpenBot risponde già su questo server Discord. Disconnettilo su quel server, poi riprova.",
  "sitePage.connect.failure.unavailable": "OpenBot non può connettersi a {name} ora. Riprova più tardi.",
  "sitePage.connect.failure.tabClosed":
    "La scheda di OpenBot che ha avviato la connessione a {name} non ha risposto. Apri OpenBot nel browser e connetti di nuovo {name}.",
  "sitePage.connect.failure.failed": "{name} non ha completato la connessione. Riprova.",
  "sitePage.connect.restartHint": "In OpenBot, apri {marketplace}, poi {apps}, poi {name}, e seleziona {connect}.",
  "sitePage.connect.notOpened":
    "Avvia OpenBot, poi riprova. Se OpenBot non è su questo computer, scaricalo e connetti {name} dall’app.",
  "sitePage.openApp.title": "Non si è aperto nulla?",
  "sitePage.openApp.dismiss": "Non ora",
  "sitePage.billing.pageTitle": "Fatturazione OpenBot",
  "sitePage.billing.updatedTitle": "Fatturazione aggiornata",
  "sitePage.billing.updatedBody": "Torna a OpenBot. Puoi chiudere questa pagina.",
  "sitePage.billing.cancelledTitle": "Pagamento annullato",
  "sitePage.billing.cancelledBody": "Non è stato addebitato nulla. Torna a OpenBot.",
  "sitePage.report.pageTitle": "Segnala un sito ospitato — OpenBot",
  "sitePage.report.title": "Segnala un sito ospitato",
  "sitePage.report.intro": "Invia una segnalazione su contenuti dannosi o illeciti a un indirizzo openbot.site.",
  "sitePage.report.hostnameLabel": "Indirizzo del sito",
  "sitePage.report.hostnameMissing": "Inserisci l’indirizzo del sito",
  "sitePage.report.reasonLabel": "Motivo",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Malware",
  "sitePage.report.reason.abuse": "Abuso",
  "sitePage.report.reason.copyright": "Copyright",
  "sitePage.report.reason.other": "Altro",
  "sitePage.report.detailsLabel": "Dettagli",
  "sitePage.report.optional": "Facoltativo",
  "sitePage.report.detailsPlaceholder": "Qual è il problema di questo sito?",
  "sitePage.report.send": "Invia segnalazione",
  "sitePage.report.sending": "Invio…",
  "sitePage.report.tooMany": "Troppe segnalazioni. Riprova più tardi.",
  "sitePage.report.sendFailed": "Impossibile inviare la segnalazione. Riprova.",
  "sitePage.report.writeTo": "Puoi anche scrivere a {email}.",
  "sitePage.report.sentTitle": "Segnalazione inviata",
  "sitePage.report.sentBody": "Grazie. Abbiamo ricevuto la tua segnalazione.",
  "sitePage.report.home": "Vai alla pagina iniziale",
  "sitePage.pricing.title": "Prezzi di OpenBot",
  "sitePage.pricing.description":
    "Server ospitati e una licenza per i team. OpenBot è gratuito per uso personale sul tuo computer.",
  "sitePage.pricing.heading": "Prezzi",
  "sitePage.pricing.enterprise.title": "Enterprise",
  "sitePage.pricing.enterprise.body":
    "Server più grandi, più di {count} membri o qualsiasi altra cosa ti serva. Con supporto enterprise.",
  "sitePage.pricing.enterprise.contact": "Contatta le vendite",
} as const satisfies PartialTranslation<typeof source>;
