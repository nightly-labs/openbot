import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "La cronologia non è disponibile per questa richiesta. Rileggi la cronologia recente o usa channel_history per il lavoro nei canali.",
  "error.agent.toolRequestInvalid":
    "Argomenti di ricerca del tool non validi. Usa lo schema dichiarato e un nome di tool qualificato originale.",
  "error.agent.approvalWhileDeleting": "Impossibile concedere l'approvazione mentre l'agente viene eliminato.",
  "error.agent.accessLocalOnly": "L'accesso dell'agente si può cambiare solo sul computer che lo esegue.",
  "error.agent.duplicateCleanupFailed":
    "La duplicazione dell'agente non è riuscita e non è stato possibile rimuovere la copia incompleta.",
  "error.agent.commitEffectsFailed": "La transazione è stata confermata, ma i suoi effetti salvati non sono riusciti.",
  "error.agent.settingsLocalOnly": "Le impostazioni dell'agente si possono cambiare solo sul computer che lo esegue.",
  "error.agent.skillsLocalOnly": "Le skill si possono cambiare solo sul computer che esegue l'agente.",
  "error.agent.addLocalOnly": "Gli agenti si possono aggiungere solo sul computer che li esegue.",
  "error.agent.joinedServerUpdate": "Un agente su un server a cui ti sei unito non si può aggiornare da qui.",
  "error.agent.searchQueryRequired": "Serve un testo di ricerca.",
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
  "error.agent.waitForTasksBeforeProviderChange":
    "Alcune attività di questo agente sono in corso. Attendi che finiscano, o interrompile, prima di cambiare provider.",
  "error.agent.waitBeforeClearContext":
    "Aspetta che il turno attivo e la coda finiscano prima di iniziare una nuova chat.",
  "error.agent.waitBeforeCompactContext":
    "Attendi la fine del turno attivo e della coda prima di compattare il contesto.",
  "error.agent.compactContextUnavailable": "Questo agente non può compattare il suo contesto ora.",
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
  "error.agent.turnStalled":
    "{provider} ha smesso di rispondere, quindi OpenBot ha terminato questo turno. Invia di nuovo il messaggio o scegli un altro modello.",
  "error.agent.selectedGone": "L'agente selezionato non esiste più.",
  "error.agent.profileEndpointsChanged": "Gli endpoint personalizzati sono cambiati durante la generazione. Riprova.",
  "error.agent.profileInvalid": "Il provider ha restituito un profilo non valido. Prova a rivedere il prompt.",
  "error.agent.profileSectionUnavailable":
    "La sezione generata non è disponibile. Riprova o scegli una sezione a mano.",
  "error.agent.profileTimedOut": "La generazione del profilo è scaduta. Riprova.",
  "error.agent.profileDisconnected": "Il provider si è disconnesso durante la generazione del profilo.",
  "error.agent.profileToolUse": "Il provider ha provato a usare un tool. Prova a rivedere il prompt.",
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
  "error.agent.newChatLocalOnly": "Solo il computer che esegue l'agente può consentirgli di avviare nuove chat.",
  "error.agent.quickAcknowledgementLocalOnly":
    "Solo il computer che esegue l'agente può modificare questa impostazione.",
  "error.agent.sideQuestionBusy": "Ci sono troppe domande a parte in corso. Riprova tra poco.",
  "error.agent.sideQuestionFailed": "L'agente non è riuscito a rispondere alla domanda a parte. Riprova.",
  "error.agent.busyMessageModeLocalOnly":
    "Cosa fanno i messaggi mentre l'agente lavora si può impostare solo sul computer che lo esegue.",
  "error.agent.backupModelsLocalOnly":
    "I modelli di riserva si possono impostare solo sul computer che esegue l'agente.",
  "error.agent.taskLimitLocalOnly": "Il limite di attività si può impostare solo sul computer che esegue l'agente.",
  "error.agent.localScriptsOff": "Questo agente non consente gli script locali.",
  "error.agent.localScriptsRateLimited":
    "Gli script locali hanno inviato a questo agente {limit} messaggi o richieste di routine nell'ultima ora. Riprova più tardi.",
  "error.agent.automationOff": "Questo agente non consente agli script locali di eseguire le sue routine.",
  "error.agent.automationPayloadTooLong": "Il payload supera i {limit} caratteri.",
  "error.agent.automationRateLimited":
    "Gli script locali hanno eseguito le routine di questo agente {limit} volte nell'ultima ora. Riprova più tardi.",
  "error.agent.workspaceOnlyMacOnly":
    "Solo workspace è disponibile per questo provider solo su macOS. Scegli Accesso completo nelle impostazioni dell'agente.",
  "error.agent.lowMemory":
    "Questo server ha poca memoria. Il tuo messaggio resta in coda e parte quando si libera memoria. Un piano più grande dà più memoria al server.",
  "error.agent.lowMemoryServer":
    "Questo server ha poca memoria. Il tuo messaggio resta in coda e parte quando si libera memoria.",
  "error.agent.workspaceOnlyToolMissing":
    "Solo workspace richiede {tool}, che OpenBot non ha trovato. Installalo, oppure scegli Accesso completo nelle impostazioni dell'agente.",
  "error.agent.claudeSandboxUnavailable":
    "Solo workspace richiede la sandbox di Claude, che Claude non riesce ad avviare su questo computer: {reason}. Scegli Accesso completo o un altro provider nelle impostazioni dell'agente.",
  "error.agent.screenCaptureOff":
    "L'acquisizione dello schermo è disattivata per questo agente. L'utente può attivare il Controllo del computer nelle impostazioni dell'agente.",
  "error.agent.screenCaptureUnavailable": "L'acquisizione dello schermo non è disponibile su questo computer.",
  "error.agent.screenCaptureShared":
    "L'acquisizione dello schermo non funziona in una conversazione Slack, Discord o Telegram, perché altre persone ricevono i suoi file.",
  "error.agent.screenCaptureDeclined":
    "L'utente non ha permesso questa acquisizione dello schermo. Non è stato acquisito nulla.",
  "error.agent.screenCaptureWindowMissing":
    "Quella finestra ora non è aperta. Chiama list_capture_sources per ottenere gli id attuali delle finestre.",
  "error.agent.screenCaptureDisplayMissing":
    "Quello schermo ora non è collegato. Chiama list_capture_sources per ottenere gli id attuali degli schermi.",
  "error.agent.screenCaptureRegionOutside":
    "L'area non è dentro un solo schermo. Usa punti del desktop entro i limiti di uno schermo indicato da list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot non ha il permesso Registrazione schermo. Chiedi all'utente di aprire Impostazioni di Sistema > Privacy e sicurezza > Registrazione schermo e audio di sistema, attivare OpenBot, poi uscire e riaprire OpenBot.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows ha restituito un'immagine vuota. Chiedi all'utente di sbloccare il computer e chiudere i contenuti protetti. Anche un criterio dell'organizzazione può bloccare l'acquisizione dello schermo.",
  "error.agent.screenCaptureFailed": "L'acquisizione dello schermo non è riuscita. Riprova.",
} as const satisfies PartialTranslation<typeof source>;
