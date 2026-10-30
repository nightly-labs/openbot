import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Gli eventi non sono disponibili su questo host.",
  "error.backend.databaseIntegrity": "Il database di OpenBot non ha superato il controllo di integrità.",
  "error.backend.webhookRouteLimit": "Un host può avere al massimo {limit} routine webhook.",
  "error.backend.webhookSettingsInvalid": "Controlla le impostazioni del webhook e riprova.",
  "error.backend.webhookRouteUnavailable":
    "Il percorso pubblico del webhook non è pronto. Controlla la connessione all'host e riprova.",
  "error.backend.browserViewRemoteOnly": "La vista in diretta del browser è disponibile solo per un host remoto.",
  "error.backend.browserViewUnsupported": "Questo host remoto non supporta la vista in diretta del browser.",
  "error.backend.browserViewLimit": "Su questo host ci sono troppe viste del browser aperte.",
  "error.backend.browserViewEnded": "La vista in diretta di questa pagina è terminata.",
  "error.backend.browserViewFailed": "La vista in diretta di questa pagina non è riuscita.",
  "error.backend.windowTemporarilyUnavailable": "La finestra di OpenBot non è al momento disponibile.",
  "error.backend.windowUnavailable": "La finestra di OpenBot non è disponibile.",
  "error.backend.sunshineApiHttp": "L'API di Sunshine ha risposto con errore HTTP {status}.",
  "error.backend.sunshinePortsUnavailable":
    "Impossibile riservare una famiglia di porte Sunshine libera per il desktop remoto.",
  "error.backend.moonlightPortsUnavailable":
    "Impossibile riservare un intervallo di porte Moonlight WebRTC libero per il desktop remoto.",
  "error.backend.iceServerNoPort": "Il server ICE del desktop remoto non ha ottenuto una porta.",
  "error.backend.remoteDesktopStoppedWhileStarting": "L'ambiente del desktop remoto è stato fermato durante l'avvio.",
  "error.backend.sunshineNotStarted": "Sunshine non si è avviato su una famiglia di porte riservata.",
  "error.backend.moonlightNoHost": "Moonlight non ha nessun host locale associato.",
  "error.backend.sunshineNoDesktop": "Sunshine non ha pubblicato l'applicazione Desktop.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine ha restituito richieste di associazione locali ambigue.",
  "error.backend.sunshineNoPairingRequest": "Sunshine non ha ricevuto la richiesta di associazione locale prevista.",
  "error.backend.moonlightPairingHttp": "L'associazione di Moonlight è fallita con errore HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "Moonlight ha rifiutato l'associazione con Sunshine.",
  "error.backend.moonlightNoPin": "Moonlight non ha restituito un PIN di associazione.",
  "error.backend.moonlightPairingIncomplete": "L'associazione di Moonlight non è stata completata.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web non è una build incorporata di OpenBot.",
  "error.backend.moonlightEmptyResponse": "Moonlight ha restituito una risposta vuota.",
  "error.backend.remoteDesktopTimeout": "La richiesta al desktop remoto è scaduta.",
  "error.backend.moonlightApiHttp": "L'API di Moonlight ha risposto con errore HTTP {status}.",
  "error.backend.sunshineExited": "Sunshine si è chiuso prima che la sua API HTTPS sulla porta {port} fosse pronta.",
  "error.backend.sunshineNoAnswer": "Sunshine non ha risposto.",
  "error.backend.sunshineTlsUnexpected": "Sunshine ha restituito un certificato TLS inatteso.",
  "error.backend.moonlightWebExited": "Moonlight Web si è chiuso prima che {url} fosse pronto.",
  "error.backend.moonlightWebNotReady": "Moonlight Web non è diventato pronto.",
  "error.backend.channelDeleteUnsupported": "Questo server non supporta l'eliminazione dei canali.",
  "error.backend.browserNavigateUnsupported":
    "Questo host remoto non supporta la navigazione dalla barra degli indirizzi in una scheda esistente.",
  "error.backend.browserUserControlBusy":
    "Questa scheda del browser attende un segreto. Rispondi prima alla richiesta del segreto.",
  "error.backend.browserUserControlUnsupported":
    "Questo host remoto non supporta il controllo di una scheda del browser.",
  "error.backend.browserSignInUnsupported": "Questo host remoto non può ricevere un accesso da questo computer.",
  "error.backend.browserSignInOpenFailed": "OpenBot non è riuscito ad aprire la finestra di accesso.",
  "error.backend.browserSignInReadFailed": "OpenBot non è riuscito a leggere l’accesso dalla finestra.",
  "error.backend.browserStopUnsupported": "Questo host remoto non può interrompere il caricamento di una pagina.",
  "error.backend.sharedDataLocalOnly": "I dati condivisi sono gestiti sul computer su cui girano questi agenti.",
  "error.backend.browserUrlProtocol": "Sono consentiti solo URL del browser HTTP(S).",
  "error.backend.sunshineNotReady": "Sunshine non è diventato pronto.",
  "error.backend.sunshineNotReadyReason": "Sunshine non è diventato pronto. {reason}",
  "error.backend.channelLeadModelUnavailable": "Il modello del responsabile del canale non è disponibile.",
  "error.backend.sharedDataUnavailable": "I dati condivisi non sono disponibili.",
  "error.backend.shuttingDown": "OpenBot si sta chiudendo.",
  "error.backend.channelUnconfirmedStart":
    "Il canale ha un avvio di assegnazione non confermato. Controlla il risultato prima di eliminarlo.",
  "error.backend.channelNotFound": "Canale non trovato.",
  "error.backend.channelMemberUnavailable": "Un membro del canale non è disponibile.",
  "error.backend.channelArchived": "Ripristina questo canale prima di inviare messaggi o modificare le attività.",
  "error.backend.channelReferenceUnavailable": "Il messaggio del canale a cui si fa riferimento non è disponibile.",
  "error.backend.channelTaskNotFound": "Attività del canale non trovata.",
  "error.backend.channelTaskComplete": "Questa attività è già completata.",
  "error.backend.channelSelectAgent": "Seleziona un agente.",
  "error.backend.channelLeadRequired":
    "Scegli un responsabile del canale disponibile o assegna questa attività a un membro.",
  "error.backend.channelRoutingTooLong":
    "Questa richiesta supera il limite del contesto di instradamento. Seleziona un membro o invia una richiesta più breve.",
  "error.backend.channelTaskMemberRequired": "Scegli un membro per questa attività.",
  "error.backend.channelTaskStopped": "Interrotta. Continua o riassegna questa attività.",
  "error.backend.channelRoutingUnreadable":
    "Il responsabile non ha potuto instradare questo messaggio. Riassegnalo a un membro.",
  "error.backend.channelRoutingFailed": "L'instradamento non è riuscito. Scegli un membro o riprova.",
  "error.backend.channelLeadTimedOut":
    "Il responsabile del canale non ha risposto in tempo. Scegli un membro o riprova.",
  "error.backend.channelLeadFailed":
    "Il responsabile del canale non è riuscito a instradare questo messaggio. Scegli un membro o riprova.",
  "error.backend.channelRequestMemberRequired": "Scegli un membro per questa richiesta.",
  "error.backend.channelDeliveryNotCreated": "La consegna del canale non è stata creata.",
  "error.backend.channelAssignmentStopped": "Questa assegnazione del canale è stata interrotta o sostituita.",
  "error.backend.channelAssigneeUnavailable": "L'agente assegnato non è disponibile.",
  "error.backend.channelAssigneeRemoved": "Il membro assegnato è stato rimosso.",
  "error.backend.channelAssigneeReassign": "Il membro assegnato non è disponibile. Riassegna questa attività.",
  "error.backend.channelAssignmentChanged": "Questa assegnazione del canale è cambiata.",
  "error.backend.channelMemberRequired": "Seleziona un membro disponibile di questo canale.",
  "error.backend.memoryEssentialBudget":
    "Le memorie essenziali superano il limite del prompt. Imposta una voce su «cerca quando serve» e riprova.",
  "error.backend.memorySelectionConflict": "La memoria è cambiata. Ricaricala e riprova.",
  "error.backend.memorySelectionUserControlled":
    "La selezione di questa memoria è controllata dall'utente. Mantieni la scelta dell'utente.",
  "error.backend.memorySearchQuery": "Inserisci una o più parole da cercare, fino a 256 caratteri.",
  "error.backend.memoryOperationFailed": "L'operazione sulla memoria non è riuscita. Riprova.",
  "error.backend.memoryGone": "Questa memoria non esiste più.",
  "error.backend.routineGone": "Questa routine non esiste più.",
  "error.backend.turnNotStarted": "Il provider non ha avviato questo turno.",
  "error.backend.routineResultConnectionOff":
    "Questa connessione di messaggistica è disattivata o rimossa. Scegli un altro luogo.",
  "error.backend.routineResultNoDelivery": "Questa esecuzione non ha una risposta da inviare di nuovo.",
  "error.backend.channelMemoryLimit": "Un canale può avere fino a {limit} memorie.",
  "error.backend.channelRoutineLimit": "Un canale può avere al massimo {limit} routine.",
  "error.backend.agentRoutineLimit": "Un agente può avere al massimo {limit} routine.",
  "error.backend.agentMemoryLimit": "Un agente può avere fino a {limit} memorie.",
  "error.backend.agentMemoryLimitReached":
    "Hai {saved} memorie su {limit}. Per fare spazio, aggiorna una memoria tramite memoryId con il testo combinato di due memorie correlate e poi dimentica l'altra, oppure dimentica una memoria che non è più vera. Poi riprova.",
  "error.backend.agentMemoryLimitExceeded":
    "Hai {saved} memorie e il limite è {limit}. L'utente ha impostato il limite al di sotto del numero di memorie salvate. Non dimenticare memorie per fare spazio. Di' all'utente che questa memoria non è stata salvata.",
  "error.backend.channelHistoryLeadRequired":
    "Scegli un responsabile del canale per preparare la cronologia condivisa.",
  "error.backend.channelHistoryArriving": "Un messaggio condiviso sta ancora arrivando. Riprendi quando è completo.",
  "error.backend.channelHistoryInvalid": "Il riepilogo della cronologia non è valido. Riprendi per riprovare.",
  "error.backend.channelContextTooLong":
    "Questa assegnazione supera il limite del contesto condiviso. Invia una richiesta più breve o riassegnala.",
  "error.backend.draftAttachmentLimit": "Tieni al massimo {limit} allegati della bozza.",
  "error.backend.recipientRequired": "Serve almeno un destinatario.",
  "error.backend.recipientLimit": "Un messaggio può avere al massimo {limit} destinatari.",
  "error.backend.attachmentDraftGone": "La bozza dell'allegato non esiste più: {id}",
  "error.backend.attachmentInQueueEdit": "Un allegato appartiene a una modifica in coda.",
  "error.backend.messageEmpty": "Il messaggio non può essere vuoto.",
  "error.backend.attachLimit": "Allega al massimo {limit} file.",
  "error.backend.queuedMessageNotFound": "Messaggio in coda non trovato.",
  "error.backend.cancelQueuedOnly": "Si possono annullare solo i messaggi in coda.",
  "error.backend.messageBeingEdited": "Questo messaggio è in modifica. Salva o annulla prima la modifica.",
  "error.backend.queuedMessageUnavailable": "Questo messaggio in coda non è più disponibile.",
  "error.backend.editedOnOtherDevice": "Questo messaggio è in modifica su un altro dispositivo.",
  "error.backend.editUnavailable": "Questa modifica non è più disponibile.",
  "error.backend.attachmentInOtherEdit": "Un allegato appartiene a un'altra modifica.",
  "error.backend.messageBeingSaved": "Questo messaggio è in fase di salvataggio. Riprova quando ha finito.",
  "error.backend.editQueuedOnly": "Si possono modificare solo i messaggi in coda.",
  "error.backend.attachmentNotInMessage": "Un allegato non appartiene al messaggio in coda.",
  "error.backend.queueOrderStale": "L'ordine della coda non è aggiornato. Aggiorna la coda e riprova.",
  "error.backend.fileGone": "Il file non esiste o è già stato eliminato.",
  "error.backend.managedAttachmentChanged": "L'allegato gestito manca o è cambiato: {name}",
  "error.backend.mailboxStateCorrupt":
    "Lo stato della casella è danneggiato o proviene da una versione più recente di OpenBot; non viene sovrascritto.",
  "error.backend.recipientDeleting": "Il destinatario è in fase di eliminazione. Riprova al termine dell'eliminazione.",
  "error.backend.recipientHidden": "Questo agente è nascosto. Ripristinalo per inviare messaggi.",
  "error.backend.attachBetween": "Allega da 1 a {limit} file.",
  "error.backend.attachmentNotFile": "L'allegato non è un file: {path}",
  "error.backend.generatedImageTooLarge": "L'immagine generata supera il limite di 100 MB.",
  "error.backend.attachmentNotRegularFile": "Si possono allegare solo file normali: {name}",
  "error.backend.attachmentCopyFailed": "OpenBot non è riuscito a copiare {name}.",
  "error.backend.routineNameRequired": "Il nome della routine è obbligatorio.",
  "error.backend.routineNameTooLong": "Il nome della routine è troppo lungo.",
  "error.backend.routineInstructionRequired": "L'istruzione della routine è obbligatoria.",
  "error.backend.routineInstructionTooLong": "L'istruzione della routine è troppo lunga.",
  "error.backend.routineScheduleInvalid": "La pianificazione della routine non è valida.",
  "error.backend.routineIntervalTooShort":
    "Gli intervalli delle routine devono essere di almeno {minutes} minuti. Usa {minutes} minuti o più, oppure una pianificazione giornaliera, settimanale o cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Gli intervalli delle routine devono essere di almeno {minutes} minuti. Usa {minutes} minuti o più, oppure un orario fisso.",
  "error.backend.routineCronTooOften":
    "Le pianificazioni personalizzate non possono essere eseguite più spesso di ogni {minutes} minuti.",
  "error.backend.routineAnchorInvalid": "Il punto di riferimento dell'intervallo della routine non è valido.",
  "error.backend.routineNoOccurrence": "La pianificazione non ha nessuna occorrenza nei prossimi cinque anni.",
  "error.backend.routineOncePassed":
    "L'ora di questa routine singola è già passata. Scegli una data o un'ora successiva.",
  "error.backend.routineTimezoneInvalid": "Il fuso orario della routine non è valido.",
  "error.backend.routineCronFields": "Le pianificazioni personalizzate devono usare cinque campi cron.",
  "error.backend.routineCronValueInvalid": "Il valore cron {field} non è valido.",
  "error.backend.routineCronFieldEmpty": "Il campo cron {field} è vuoto.",
  "error.backend.routineDeletionBusy": "Per questo agente è già in corso l'eliminazione di un'altra routine.",
  "error.backend.routineWaitForAgent": "Attendi che l'operazione dell'agente finisca prima di eseguire una routine.",
  "error.backend.routineRunStarting":
    "Questa esecuzione della routine si sta ancora avviando. Riprova dopo l'avvio del turno.",
  "error.backend.routineRunNoSession":
    "OpenBot non può interrompere l'esecuzione attiva della routine perché la sessione del provider non è disponibile.",
  "error.backend.interruptSelf": "Un agente non può interrompere se stesso.",
  "error.backend.interruptOtherWork":
    "Questo agente sta lavorando a un'attività che il tuo messaggio non ha avviato. Solo l'utente o chi ha inviato quell'attività può fermarla.",
  "error.backend.interruptStarting": "Questo agente sta ancora avviando un turno. Riprova dopo l'avvio del turno.",
  "error.backend.interruptNoSession":
    "OpenBot non può interrompere questo agente perché la sua sessione del provider non è disponibile.",
  "error.backend.memoryTextRequired": "Il testo della memoria è obbligatorio.",
  "error.backend.memoryTextTooLong": "Il testo della memoria è troppo lungo.",
  "error.backend.mcpServerGone": "Questo server MCP non esiste più.",
  "error.backend.routineFlowLinkGone": "Questo collegamento non esiste più.",
  "error.backend.routineFlowSameAgent": "Un agente non può passare il lavoro a se stesso.",
  "error.backend.routineFlowIntoOwner":
    "La routine inizia con il suo agente, quindi quell'agente non può ricevere lavoro da un altro.",
  "error.backend.routineFlowNotOnPath":
    "Questo agente non fa ancora parte della routine. Collegalo prima alla routine.",
  "error.backend.routineFlowDuplicate": "Questi agenti sono già collegati in questa routine.",
  "error.backend.routineFlowCycle": "Questo collegamento creerebbe un ciclo.",
  "error.backend.routineFlowLinkLimit": "Una routine può avere al massimo {limit} collegamenti.",
  "error.backend.agentWaitLimit":
    "Questo agente ha già {count} attese aperte. Chiudi un'attesa con openbot.close_wait prima di aprirne un'altra.",
  "error.backend.agentWaitGone": "Questa attesa non è aperta. L'agente l'ha chiusa, oppure qualcuno l'ha annullata.",
  "error.backend.agentWaitNoRequest":
    "Un'attesa ha bisogno di un messaggio per continuare. Questo turno non ha messaggi.",
  "error.backend.agentWaitOwnChatOnly":
    "Apri un'attesa solo nella tua chat. Un canale o un'attività di messaggistica non può attendere.",
  "error.backend.agentWaitNoteRequired": "Scrivi una breve nota che spieghi a cosa serve l'attesa.",
  "error.backend.agentWaitRoutineGone": "Questo agente non ha una routine con questo id.",
  "error.backend.agentWaitNoRoutine":
    "Solo un'esecuzione di una delle tue routine risveglia un'attesa, e non hai routine. Creane una con openbot.create_routine, poi apri l'attesa.",
  "error.backend.agentWaitRemoteUnsupported":
    "Le attese aperte sono disponibili solo per gli agenti su questo computer.",
  "error.backend.markUnreadRemoteUnsupported":
    "Segnare un messaggio come non letto è disponibile solo per gli agenti su questo computer.",
  "error.backend.routineFlowHandoffFailed": "La routine non è riuscita a passare il lavoro a questo agente.",
  "error.backend.mcpServerLimit": "OpenBot conserva fino a {limit} server MCP.",
  "error.backend.mcpServerNameTaken": "Esiste già un server MCP chiamato {name}.",
  "error.backend.mcpServerInvalid": "OpenBot non può salvare questa configurazione del server MCP.",
  "error.backend.mcpServerNoAnswer": "Il server non ha risposto entro {seconds} secondi.",
  "error.backend.mcpSignInNotAccepted": "Il server non ha accettato quell'accesso.",
  "error.backend.mcpSignInClientRefused":
    "Il server di accesso non ha accettato OpenBot al completamento dell'accesso. Accedi di nuovo: OpenBot si registra di nuovo sul server.",
  "error.backend.mcpCommandNotFound": "Comando non trovato: {command}",
  "error.backend.mcpRegistrationRefused":
    "Il server di accesso non accetta ancora OpenBot come app. La causa non è il tuo account. Usa un altro modo per connetterti, ad esempio un server MCP locale.",
  "error.backend.mcpSignInAbandonedGeneric": "L'accesso è stato abbandonato.",
  "error.backend.mcpSignInForgotten": "L'accesso MCP è stato dimenticato mentre era in corso.",
  "error.backend.mcpSignInAbandoned": "L'accesso MCP è stato abbandonato.",
  "error.backend.mcpSignInNoBrowser": "Questo accesso MCP non può aprire un browser.",
  "error.backend.mcpSignInNotWebPage": "L'indirizzo di accesso non è una pagina web.",
  "error.backend.mcpSignInRequired": "Questo server richiede l'accesso. Scegli «Accedi» per continuare nel browser.",
  "error.backend.mcpSignInOnHost":
    "Questo server richiede l'accesso. Accedi a questo server in OpenBot sul computer host.",
  "error.backend.mcpSignInNeedsHttps":
    "Questo server richiede l'accesso e OpenBot accede solo tramite https. Cambia l'URL in {url}.",
  "error.backend.mcpSignInCancelled": "L'accesso è stato annullato.",
  "error.backend.mcpSignInTimedOut": "L'accesso non è stato completato nel browser.",
  "error.backend.mcpSignInResponseTimedOut": "La risposta dell'accesso non è arrivata in tempo.",
  "error.backend.mcpSignInMetadataUnreadable":
    "OpenBot non ha potuto leggere le informazioni di accesso di questo server. Controlla l’indirizzo del server e riprova.",
  "error.backend.mcpServerExited":
    "Il server si è fermato prima di rispondere. Esegui il comando in un terminale per vedere l'errore.",
  "error.backend.mcpServerFailedToStart": "Il server non si è avviato: {reason}",
  "error.backend.mcpOAuthProxyUnavailable":
    "OpenBot non è riuscito ad avviare la connessione di accesso locale per questo server. Riavvia OpenBot e riprova.",
  "error.backend.mcpOAuthSignInNeeded":
    "L'accesso a questo server MCP è terminato. L'utente deve accedere di nuovo in OpenBot.",
  "error.backend.mcpServerUnreachable": "OpenBot non è riuscito a raggiungere il server. Controlla l'URL e la rete.",
  "error.backend.mcpLocalServerOff":
    "Nessun server risponde all'indirizzo {address} su questo computer. Avvia il server, o attivalo nell'app che lo esegue, poi riprova.",
  "error.backend.mcpServerBlocked":
    "Questo computer ha bloccato la connessione al server. Controlla il firewall o il software di sicurezza, poi riprova.",
  "error.backend.mcpServerIncompatible":
    "A questo indirizzo qualcosa ha risposto, ma non come server MCP via Streamable HTTP. Controlla l'URL e aggiorna l'app che esegue il server.",
  "error.backend.mcpRemoteBridge":
    "{reason} Questo comando esegue il bridge mcp-remote. Scegli invece Streamable HTTP con l'URL {url} e OpenBot ti fa accedere.",
  "error.backend.oauthNotHttps":
    "L'endpoint OAuth {origin} non usa https, quindi le credenziali non sono state inviate.",
  "error.backend.oauthTooManyRedirects": "L'endpoint OAuth ha reindirizzato troppe volte.",
  "error.backend.oauthRedirectOrigin":
    "L'endpoint OAuth ha reindirizzato a {origin}, quindi le credenziali non sono state inoltrate.",
  "error.backend.oauthTimedOut": "L'endpoint OAuth {origin} non ha risposto in tempo.",
  "error.backend.oauthResponseTooLarge": "L'endpoint OAuth {origin} ha inviato una risposta troppo grande.",
  "error.backend.oauthResponseUnreadable": "Impossibile leggere la risposta dell'endpoint OAuth {origin}.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "L'endpoint OAuth {origin} è su una rete privata, ma il server MCP è pubblico, quindi le credenziali non sono state inviate.",
  "error.backend.sidebarSectionLimit": "Un server può avere fino a {limit} sezioni nella barra laterale.",
  "error.backend.sectionNameRequired": "Il nome della sezione è obbligatorio.",
  "error.backend.sectionNameTooLong": "Il nome della sezione è troppo lungo.",
  "error.backend.sectionNameDuplicate": "I nomi delle sezioni devono essere univoci.",
  "error.backend.directMessageRequired": "Scrivi prima un messaggio.",
  "error.backend.directMessageTooLong": "Un messaggio diretto può avere fino a {limit} caratteri.",
  "error.backend.directMessageSelf": "Non puoi inviare un messaggio diretto a te stesso.",
  "error.backend.readBoundaryUnavailable": "Il punto di lettura non è più disponibile.",
  "error.backend.sharedFileOutside": "Il file condiviso deve trovarsi nella cartella condivisa.",
  "error.backend.sharedPathIsFolder": "Il percorso condiviso è una cartella, non un file.",
  "error.backend.sharedPathNotFile": "Il percorso condiviso non è un file.",
  "error.backend.workspaceFileOutside": "Il file del workspace deve trovarsi nel workspace dell'agente.",
  "error.backend.workspacePathNotFile": "Il percorso del workspace non è un file.",
  "error.backend.workspacePathNotDirectory": "Il percorso del workspace non è una cartella.",
  "error.backend.workspacePathMissing": "Non esiste nulla in {path} nel workspace dell'agente {root}.",
  "error.backend.workspacePathMissingForMember": "Non esiste nulla in {path} nel workspace dell'agente.",
  "error.backend.useChannelTaskControls": "Usa i controlli delle attività del canale per questa assegnazione.",
  "error.backend.editFinished": "Questa modifica è già terminata.",
  "error.backend.editCancelled": "Questa modifica è stata annullata, quindi il messaggio mantiene il testo originale.",
  "error.backend.editSaved": "Questa modifica è già stata salvata.",
  "error.backend.editSavedDifferent":
    "Questa modifica è già stata salvata con contenuti diversi. Le tue modifiche non sono state salvate.",
  "error.backend.useChannelTaskControlsWork": "Usa i controlli delle attività del canale per il lavoro nel canale.",
  "error.backend.steerTurnChanged": "Il turno attivo è cambiato prima che questo messaggio potesse essere indirizzato.",
  "error.backend.steerUnsupported":
    "Questo provider non può indirizzare un turno in corso. Il tuo messaggio resta in coda.",
  "error.backend.steerRoutineRun": "È in corso una routine. Il tuo messaggio resta in coda e parte dopo la routine.",
  "error.backend.steerQueuedOnly": "Si possono indirizzare solo i messaggi in coda.",
  "error.backend.promptInactive": "Questo prompt non è più attivo.",
  "error.backend.promptAnswerMismatch": "La risposta al prompt non corrisponde a una domanda attiva.",
  "error.backend.approvalInactive": "Questa approvazione non è più attiva.",
  "error.backend.takeoverInactive": "Questo intervento nel browser non è più attivo.",
  "error.backend.authSubmitting": "L'invio dell'autenticazione è già in corso.",
  "error.backend.apiKeySaveFailed": "OpenBot non è riuscito a salvare la chiave API. Riprova.",
  "error.backend.apiKeyNotAllowed": "Solo il proprietario del server o un amministratore può inserire una chiave API.",
  "error.backend.apiKeySaving": "La chiave API è già in fase di salvataggio.",
  "error.backend.authRequestInactive": "Questa richiesta di autenticazione sicura non è più attiva.",
  "error.backend.secureAuthUnavailable": "L'autenticazione sicura non è disponibile.",
  "error.backend.browserUrlRequired": "L'URL del browser è obbligatorio.",
  "error.backend.browserUrlTooLong": "L'URL del browser è troppo lungo.",
  "error.backend.browserTabLimit": "Il browser può avere fino a {limit} schede aperte.",
  "error.backend.browserProfileMissing":
    "Il profilo browser di questo agente non esiste più. Scegli un altro profilo nelle impostazioni dell’agente.",
  "error.backend.browserProfileNotFound": "Questo profilo browser non esiste più.",
  "error.backend.browserProfileNameTaken": "Esiste già un profilo browser con questo nome.",
  "error.backend.browserSessionInUse": "Una scheda usa ancora questa sessione del browser. Riprova.",
  "error.backend.browserProfileLimit": "Puoi avere fino a {limit} profili browser.",
  "error.backend.browserLowMemory":
    "Su questo server la memoria è quasi esaurita, quindi il browser non può aprire un'altra scheda. Chiudi una scheda o attendi che gli altri agenti finiscano.",
  "error.backend.browserOpenFailed": "Impossibile aprire {url}: {reason}",
  "error.backend.popupSecureInput":
    "I popup sono bloccati durante l'inserimento sicuro. Termina o annulla l'inserimento sicuro, poi riprova dalla pagina.",
  "error.backend.popupUnsupportedType":
    "Questo tipo di popup non è supportato. Usa un normale link o pulsante di accesso nella pagina.",
  "error.backend.popupUnsupportedAddress":
    "Questo popup usa un indirizzo non supportato. Usa un'opzione di accesso HTTP o HTTPS nella pagina.",
  "error.backend.popupTabLimit":
    "È stato raggiunto il limite di schede del browser. Chiudi una scheda, poi riprova dalla pagina.",
  "error.backend.popupLoadFailed": "Impossibile caricare il popup. Riprova ad accedere dalla pagina originale.",
  "error.backend.browserTabNotFound": "Scheda del browser non trovata.",
  "error.backend.authActive": "L'autenticazione è già attiva.",
  "error.backend.authHttpsRequired": "L'autenticazione sicura richiede HTTPS.",
  "error.backend.authDigitsRange": "I codici di autenticazione richiedono da 4 a 12 cifre.",
  "error.backend.authExpired": "La richiesta di autenticazione è scaduta.",
  "error.backend.authDigitsRequired": "Inserisci il numero di cifre richiesto.",
  "error.backend.browserViewProtected": "La vista del browser è protetta durante l'autenticazione.",
  "error.backend.browserPreviewPageChanged": "La pagina del browser è cambiata durante l'anteprima. Riprova.",
  "error.backend.browserInputProtected": "L'input del browser è protetto durante l'autenticazione.",
  "error.backend.mcpServerHttpCredentials":
    "Il server ha risposto {status}. Controlla la chiave API o le altre credenziali.",
  "error.backend.mcpServerHttpUrl":
    "Il server ha risposto {status}. Controlla l'URL. Il link potrebbe essere sbagliato, scaduto o eliminato.",
  "error.backend.mcpSignInAppUrl": "L'app di accesso richiede un URL del server valido.",
  "error.backend.mcpSignInAppClientId": "Inserisci l'ID client dell'app di accesso.",
  "error.backend.mcpSignInAppIssuerChanged":
    "Il server di accesso di questo server MCP è cambiato, quindi OpenBot non gli ha inviato l'app di accesso. Se la modifica è corretta, rimuovi l'app di accesso e aggiungila di nuovo.",
  "error.backend.mcpSignInAppNoServer":
    "Salva questo server MCP come server con URL prima di aggiungere un'app di accesso.",
  "error.backend.mcpSignInAppUnavailable": "Questo computer non può conservare un'app di accesso.",
  "error.backend.taskMoveRefused":
    "Solo un messaggio che hai inviato soltanto a questo agente può essere eseguito come attività.",
  "error.backend.taskNotFound": "Questa attività non è disponibile.",
  "error.backend.taskClosed": "Questa attività è chiusa. Riaprila per inviare un messaggio.",
  "error.backend.taskStillRunning": "Questa attività è ancora in corso. Attendi che si fermi, poi chiudila.",
  "error.backend.threadNotFound": "Questo thread non è disponibile.",
  "error.backend.threadStillRunning": "Questo thread è ancora in esecuzione. Interrompilo, poi riprova.",
  "error.backend.threadArchived": "Questo thread è archiviato. Ripristinalo per inviare un messaggio.",
  "error.backend.threadTitleRequired": "Dai al thread un titolo breve.",
  "error.backend.threadOpenLimitReached":
    "Questo agente ha {count} thread aperti. Archivia un thread, poi avviane o ripristinane un altro.",
  "error.backend.threadRemoteUnsupported": "I thread sono disponibili solo per gli agenti su questo computer.",
  "error.backend.threadMoveRefused":
    "Solo un messaggio che hai inviato soltanto a questo agente può essere eseguito in un nuovo thread.",
  "error.backend.taskTitleRequired": "Dai all'attività un titolo breve.",
  "error.backend.taskToolInvalid":
    "Dai all'attività un titolo di al massimo 120 caratteri e una descrizione che dica cosa fare.",
  "error.backend.taskOwnChatOnly":
    "Avvia un'attività solo dalla tua chat. Un canale, una conversazione di messaggistica o un'altra attività non possono avviarne una.",
  "error.backend.taskOpenLimit":
    "Questo agente ha già {count} attività aperte. Attendi che l'utente ne chiuda una prima di avviare un'altra attività.",
  "error.backend.taskOpenLimitReached":
    "Questo agente ha {count} attività aperte. Chiudi un'attività, poi avviane o aprine un'altra.",
  "error.backend.taskRemoteUnsupported": "Le attività sono disponibili solo per gli agenti su questo computer.",
  "error.backend.taskStartFailed":
    "OpenBot non è riuscito ad avviare l'attività. Esegui invece il lavoro in questo turno.",
} as const satisfies PartialTranslation<typeof source>;
