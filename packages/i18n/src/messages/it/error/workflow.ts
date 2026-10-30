import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Questo workflow non esiste più.",
  "error.workflow.versionMissing": "Questa versione del workflow non esiste più.",
  "error.workflow.annotation": "Testi, note e forme non possono avere connessioni.",
  "error.workflow.port": "Un passaggio non può ricevere questo tipo di input.",
  "error.workflow.branch": "Solo una condizione può avere connessioni sì e no.",
  "error.workflow.conditionBranch": "Ogni connessione da una condizione deve essere sì o no.",
  "error.workflow.duplicateEdge": "Questi due passaggi hanno già questa connessione.",
  "error.workflow.serverTooOld": "Questo server non supporta i workflow. Aggiorna OpenBot sul computer che lo esegue.",
  "error.workflow.nodeUnsupported":
    "Questa versione di OpenBot non può ancora eseguire passaggi di immagine, file e messaggio.",
  "error.workflow.interrupted": "OpenBot si è fermato durante questo passaggio. Eseguilo di nuovo.",
  "error.workflow.agentMissing": "Scegli un agente per questo passaggio.",
  "error.workflow.handoffFailed": "OpenBot non è riuscito a inviare questo passaggio al suo agente.",
  "error.workflow.agentStepEnded": "Il messaggio all’agente è stato rimosso prima della sua risposta.",
  "error.workflow.conditionUnclear": "Il modello non ha risposto sì o no.",
  "error.workflow.modelFailed": "Il modello non ha potuto rispondere. Esegui di nuovo il passaggio.",
  "error.workflow.modelBusy": "È in corso un’altra richiesta al modello. Esegui di nuovo il passaggio tra poco.",
  "error.workflow.stepMissing": "Questo passaggio non esiste più.",
  "error.workflow.nodeMissing": "Questo passaggio non è nel flusso di lavoro.",
  "error.workflow.runMissing": "Questa esecuzione non esiste più.",
  "error.workflow.notRetryable": "Solo un passaggio non riuscito o fermato può essere rieseguito.",
  "error.workflow.noDecision": "Questo passaggio non attende una decisione.",
  "error.workflow.outputPlaceMissing": "Scegli un luogo di messaggistica per questo output.",
  "error.workflow.outputConnectionOff":
    "La connessione di messaggistica di questo output è disattivata o rimossa. Scegli di nuovo un luogo.",
  "error.workflow.outputNotRunning": "La connessione di messaggistica non è attiva ora. Riprova quando è attiva.",
  "error.workflow.outputRefused": "Il luogo ha rifiutato il post. Verifica che OpenBot possa pubblicare lì.",
  "error.workflow.outputUncertain":
    "Il post si è fermato a metà. Una parte può essere già nel luogo. Controlla prima di riprovare.",
  "error.workflow.tooLarge":
    "Questo workflow è troppo grande per essere salvato. Rimuovi alcuni disegni o testi lunghi, poi riprova.",
  "error.workflow.tooLargeToSend":
    "Questo workflow è troppo grande per essere inviato a un altro computer. Aprilo sul computer che esegue il server.",
  "error.workflow.webhookMissing": "Questo passaggio non è un trigger webhook. Salva il workflow, poi riprova.",
} as const satisfies PartialTranslation<typeof source>;
