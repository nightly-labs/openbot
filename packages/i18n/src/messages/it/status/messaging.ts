import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Ci sto lavorando…",
  "status.messaging.queued": "In attesa: OpenBot sta lavorando a un'altra richiesta. La risposta arriva qui.",
  "status.messaging.busy": "Ci sono troppe richieste in attesa. Riprova più tardi.",
  "status.messaging.failed":
    "OpenBot non è riuscito a completare questa richiesta. I dettagli sono sull'host di OpenBot.",
  "status.messaging.noAnswer": "OpenBot ha finito senza una risposta scritta.",
  "status.messaging.noAgent": "Nessun agente può ancora rispondere qui. Aggiungi lo Slack Orchestrator in OpenBot.",
  "status.messaging.delegated": "Un collega ci sta lavorando. La risposta arriva qui.",
  "status.messaging.stopped": "Interrotto.",
  "status.messaging.stop": "Interrompi",
  "status.messaging.approvalTitle": "OpenBot chiede l'approvazione per continuare.",
  "status.messaging.approvalCommand": "Eseguire un comando",
  "status.messaging.approvalFileChange": "Modificare dei file",
  "status.messaging.approvalPermissions": "Ottenere altri permessi",
  "status.messaging.approve": "Approva",
  "status.messaging.deny": "Rifiuta",
  "status.messaging.approvedBy": "Approvato da {user}.",
  "status.messaging.deniedBy": "Rifiutato da {user}.",
  "status.messaging.answeredOnHost": "Risposta data sull'host di OpenBot.",
  "status.messaging.requestInactive": "Questa richiesta non è più attiva.",
  "status.messaging.onlyRequester": "Solo {user} può farlo. Può rispondere anche l'host di OpenBot.",
  "status.messaging.hostOnly": "Solo l'host di OpenBot può rispondere a questa richiesta.",
  "status.messaging.filesSkipped": "Alcuni file non sono stati inviati: {names}.",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Risponde su Slack e consulta il team",
  "status.messaging.discordNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il Discord Orchestrator in OpenBot.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Risponde su Discord e consulta il team",
  "status.messaging.integrationsSection": "Integrazioni",
  "status.messaging.signInReceived": "OpenBot ha ricevuto l'installazione di Slack. Puoi chiudere questa scheda.",
  "status.messaging.signInUnknown": "OpenBot non ha avviato questa installazione di Slack. Riavviala in OpenBot.",
  "status.messaging.telegramNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il Telegram Orchestrator in OpenBot.",
  "status.messaging.telegramLinked":
    "OpenBot è collegato a questa chat. Menziona {bot} o rispondi a un messaggio di OpenBot per interpellare gli agenti.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Risponde su Telegram e consulta il team",
} as const satisfies PartialTranslation<typeof source>;
