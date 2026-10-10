import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "La cronologia non è disponibile per questa richiesta. Rileggi la cronologia recente, oppure usa channel_history per il lavoro nei canali.",
  "error.agent.toolRequestInvalid":
    "Argomenti di ricerca dello strumento non validi. Usa lo schema dichiarato e un nome di strumento qualificato originale.",
  "error.agent.approvalWhileDeleting": "Impossibile concedere l'approvazione mentre l'agente viene eliminato.",
  "error.agent.accessLocalOnly": "L'accesso dell'agente si può cambiare solo sul computer che lo esegue.",
  "error.agent.duplicateCleanupFailed":
    "La duplicazione dell'agente non è riuscita e non è stato possibile rimuovere la copia incompleta.",
  "error.agent.commitEffectsFailed": "La transazione è stata confermata, ma i suoi effetti salvati non sono riusciti.",
  "error.agent.settingsLocalOnly": "Le impostazioni dell'agente si possono cambiare solo sul computer che lo esegue.",
  "error.agent.skillsLocalOnly": "Le skill si possono cambiare solo sul computer che esegue l'agente.",
  "error.agent.addLocalOnly": "Gli agenti si possono aggiungere solo sul computer che li esegue.",
  "error.agent.joinedServerUpdate": "Un agente su un server a cui ti sei unito non si può aggiornare da qui.",
  "error.agent.searchQueryRequired": "Serve una ricerca.",
  "error.agent.messageTooLong": "Il messaggio è troppo lungo.",
  "error.agent.messageOrAttachmentRequired": "Serve un messaggio o un allegato.",
  "error.agent.promptAnswersTooLong": "Le risposte al prompt sono troppo lunghe.",
  "error.agent.gone": "Questo agente non esiste più.",
  "error.agent.profileGenerationBusy": "La generazione del profilo è occupata. Riprova tra poco.",
  "error.agent.initialMessageRequired": "Serve il messaggio iniziale.",
  "error.agent.initialMessageTooLong": "Il messaggio iniziale è troppo lungo.",
  "error.agent.setupCleanupFailed":
    "La configurazione dell'agente non è riuscita e non è stato possibile rimuovere l'agente incompleto.",
  "error.agent.modelUnavailable": "Il modello dell'agente selezionato non è disponibile.",
  "error.agent.modelProviderNotConnected":
    "Il modello dell'agente selezionato «{model}» non è disponibile: {provider} non è connesso.",
  "error.agent.modelListEmpty":
    "Il modello dell'agente selezionato «{model}» non è disponibile: {provider} non ha elencato modelli. Ultimo errore: {detail}",
  "error.agent.modelListEmptyNoError":
    "Il modello dell'agente selezionato «{model}» non è disponibile: {provider} non ha elencato modelli.",
  "error.agent.modelNotInProviderList":
    "Il modello dell'agente selezionato «{model}» non è disponibile: {provider} non lo elenca.",
  "error.agent.modelProviderMismatch": "Il modello selezionato non appartiene a quel provider.",
  "error.agent.modelNotListed": "Il modello «{model}» non è disponibile. Modelli disponibili: {models}.",
  "error.agent.providerNotListed":
    "Al momento nessun modello di {provider} è disponibile. Chiama list_models per vedere i modelli disponibili.",
  "error.agent.reasoningEffortUnsupported":
    "Il modello «{model}» non supporta il livello di impegno «{effort}». Livelli supportati: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} non ha modelli disponibili e nessun altro provider con accesso ne ha. Accedi a un provider, oppure cambia il provider predefinito in Impostazioni del server → Provider.",
  "error.agent.noStartingModel":
    "{provider} non ha modelli disponibili e nessun altro provider con accesso ne ha. Accedi a un provider, oppure cambia il provider predefinito in Provider e permessi.",
  "error.agent.waitBeforeProviderChange": "Aspetta che il turno attivo e la coda finiscano prima di cambiare provider.",
  "error.agent.waitBeforeClearContext":
    "Aspetta che il turno attivo e la coda finiscano prima di iniziare una nuova chat.",
  "error.agent.unknown": "Agente sconosciuto: {id}",
  "error.agent.onlyUserWidensSettings":
    "Solo l'utente può dare a un agente l'accesso completo o attivare il Controllo del computer. Chiedi all'utente di cambiarlo nelle impostazioni dell'agente.",
  "error.agent.queuedMessageCreateFailed": "Impossibile creare il messaggio in coda.",
  "error.agent.messageUnavailable": "Il messaggio non è più disponibile.",
  "error.agent.hostLimit": "Un host può avere fino a {limit} agenti.",
  "error.agent.changedWhileDuplicating": "L'agente è cambiato durante la duplicazione. Riprova.",
  "error.agent.duplicatedAgentGone": "L'agente duplicato non esiste più.",
  "error.agent.stateCorrupt":
    "Lo stato dell'agente è danneggiato o proviene da una versione di OpenBot più recente; non viene sovrascritto.",
  "error.agent.oldRoleField":
    "I profili degli agenti salvati usano il vecchio campo role; aggiorna i dati prima di avviare OpenBot.",
  "error.agent.duplicateIds": "Lo stato degli agenti contiene ID di agente duplicati; non viene sovrascritto.",
  "error.agent.copyNameFailed": "OpenBot non è riuscito a creare un nome univoco per la copia dell'agente.",
  "error.agent.endpointRemoved": "L'endpoint usato da questo agente è stato rimosso. Scegli un altro modello.",
  "error.agent.selectedGone": "L'agente selezionato non esiste più.",
  "error.agent.profileEndpointsChanged": "Gli endpoint personalizzati sono cambiati durante la generazione. Riprova.",
  "error.agent.profileInvalid": "Il provider ha restituito un profilo non valido. Prova a rivedere il prompt.",
  "error.agent.profileSectionUnavailable":
    "La sezione generata non è disponibile. Riprova o scegli una sezione a mano.",
  "error.agent.profileTimedOut": "La generazione del profilo è scaduta. Riprova.",
  "error.agent.profileDisconnected": "Il provider si è disconnesso durante la generazione del profilo.",
  "error.agent.profileToolUse": "Il provider ha provato a usare uno strumento. Prova a rivedere il prompt.",
  "error.agent.profileFailed": "Il provider non è riuscito a generare un profilo. Riprova.",
  "error.agent.profileTooLarge": "Il profilo generato è troppo grande. Prova con un prompt più breve.",
  "error.agent.profileNotStarted": "Il provider non è riuscito ad avviare la generazione del profilo.",
  "error.agent.deletionBusy": "L'eliminazione dell'agente è già in corso.",
  "error.agent.stopBeforeDelete": "Ferma l'agente e annulla i suoi messaggi in coda prima di eliminarlo.",
  "error.agent.deleteIncomplete": "Non è stato possibile rimuovere del tutto i dati dell'agente. Riprova a eliminarlo.",
  "error.agent.duplicationBusy": "Questo agente è già in fase di duplicazione.",
  "error.agent.waitBeforeDuplicate": "Aspetta che l'agente finisca e svuoti la coda prima di duplicarlo.",
  "error.agent.saveOtherAgent": "Questo salvataggio appartiene a un altro agente.",
  "error.agent.savedGone": "L'agente salvato non esiste più.",
  "error.agent.storedProfileUnreadable":
    "Un profilo di agente salvato ha un valore illeggibile in «{field}»; aggiorna i dati prima di avviare OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "Il profilo di agente salvato {id} ha un valore illeggibile in «{field}»; aggiorna i dati prima di avviare OpenBot.",
  "error.agent.queueEditRejected": "Modifica della coda rifiutata: {reason}",
  "error.agent.computerUseLocalOnly":
    "Il Controllo del computer si può cambiare solo sul computer che esegue l'agente.",
  "error.agent.automationLocalOnly": "Gli script locali si possono consentire solo sul computer che esegue l'agente.",
  "error.agent.busyMessageModeLocalOnly":
    "Cosa fanno i messaggi mentre l'agente lavora si può impostare solo sul computer che lo esegue.",
  "error.agent.localScriptsOff": "Questo agente non consente gli script locali.",
  "error.agent.localScriptsRateLimited":
    "Gli script locali hanno inviato a questo agente {limit} messaggi o richieste di routine nell'ultima ora. Riprova più tardi.",
  "error.agent.automationOff": "Questo agente non consente agli script locali di eseguire le sue routine.",
  "error.agent.automationPayloadTooLong": "Il payload supera i {limit} caratteri.",
  "error.agent.automationRateLimited":
    "Gli script locali hanno eseguito le routine di questo agente {limit} volte nell'ultima ora. Riprova più tardi.",
  "error.agent.workspaceOnlyMacOnly":
    "Solo spazio di lavoro è disponibile per questo provider solo su macOS. Scegli Accesso completo nelle impostazioni dell'agente.",
  "error.agent.lowMemory":
    "Questo server ha poca memoria. Il tuo messaggio resta in coda e parte quando si libera memoria. Un piano più grande dà più memoria al server.",
  "error.agent.workspaceOnlyToolMissing":
    "Solo spazio di lavoro richiede {tool}, che OpenBot non ha trovato. Installalo, oppure scegli Accesso completo nelle impostazioni dell'agente.",
} as const satisfies PartialTranslation<typeof source>;
