import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Ha bisogno di te.",
  "notification.needsApproval": "Ha bisogno della tua approvazione.",
  "notification.needsBrowserStep": "Ha bisogno che tu completi un passaggio nel browser.",
  "notification.needsApprovalFor": "Ha bisogno della tua approvazione: {action}",
  "notification.finished": "Ha finito di lavorare.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Un passaggio attende la tua approvazione.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Un flusso di lavoro ha un nuovo risultato.",
  "notification.failed": "Si è fermato per un errore.",
  "notification.channelTitle": "{agent} in {channel}",
  "notification.channelMessage": "Ha inviato un messaggio.",
  "notification.usageLimit.title": "L'account {provider} ha raggiunto il limite",
  "notification.usageLimit.body": {
    one: "{count} agente è in attesa. OpenBot riproverà più tardi.",
    other: "{count} agenti sono in attesa. OpenBot riproverà più tardi.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agente è in attesa. Il limite si azzera {reset}.",
    other: "{count} agenti sono in attesa. Il limite si azzera {reset}.",
  },
  "notification.machineAlert.disk": "{server}: disco pieno ({percent})",
  "notification.machineAlert.memory": "{server}: memoria in uso ({percent})",
  "notification.machineAlert.cpu": "{server}: CPU occupata ({percent})",
  "notification.machineAlert.body":
    "Ha superato la soglia di avviso di {level}. Vedi Impostazioni server > Archiviazione.",
  "notification.test": "Le notifiche funzionano.",
  "notification.welcome": "OpenBot ti avviserà qui quando un agente ha bisogno di te.",
  "notification.toast.region": "Notifiche",
  "notification.toast.close": "Chiudi notifica",
} as const satisfies PartialTranslation<typeof source>;
