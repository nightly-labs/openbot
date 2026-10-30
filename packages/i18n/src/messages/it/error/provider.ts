import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot non è riuscito a registrare i server MCP nella configurazione di Codex. Controlla che il config.toml di Codex sia valido e scrivibile, poi riavvia OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot non è riuscito a registrare il Controllo del computer nella configurazione di Codex. Controlla che il config.toml di Codex sia valido e scrivibile, poi riavvia OpenBot. Puoi disattivare il Controllo del computer nelle impostazioni dell'agente per continuare senza.",
  "error.provider.codexUnresponsive": "Codex ha smesso di rispondere, quindi OpenBot ha terminato il suo processo.",
  "error.provider.acpUnresponsive": "{provider} non ha risposto in tempo, quindi OpenBot ha terminato il suo processo.",
  "error.provider.endpointsReadOnly":
    "Gli endpoint salvati sono stati scritti da una versione più recente di OpenBot, oppure il file non è leggibile. Aggiorna OpenBot per modificarli.",
  "error.provider.endpointNoSecureStorage":
    "Questo computer non ha un archivio sicuro, quindi non si può salvare una chiave API o un header. Rimuovili, oppure usa un endpoint che non richiede credenziali.",
  "error.provider.endpointDuplicate":
    "Esiste già un endpoint salvato con questo ID provider. Rimuovilo prima, oppure usa un altro ID.",
  "error.provider.endpointNotSaved": "Questo endpoint non è salvato. Aggiorna l'elenco e riprova.",
  "error.provider.endpointKeyForNewAddress":
    "L'indirizzo ha un nuovo host o una nuova porta. Inserisci di nuovo la chiave API e gli header, così quelli salvati non vengono inviati lì.",
  "error.provider.endpointSecretUnreadable":
    "Questo computer non riesce a leggere la chiave API e gli header salvati. Inserisci di nuovo la chiave API e gli header, così non se ne perde nessuno.",
  "error.provider.discoveryTimeout": "{host} non ha risposto in tempo.",
  "error.provider.discoveryUnreachable": "OpenBot non è riuscito a connettersi a {host}.",
  "error.provider.discoveryRedirect": "{host} ha inviato un reindirizzamento. Inserisci l'indirizzo finale del server.",
  "error.provider.discoveryRefused": "{host} ha rifiutato la richiesta. Controlla la chiave API e gli header.",
  "error.provider.discoveryHttp": "{host} ha risposto con HTTP {status}.",
  "error.provider.discoveryTooLarge": "L'elenco dei modelli di {host} è troppo grande.",
  "error.provider.discoveryInvalid": "{host} non ha inviato un elenco di modelli compatibile con OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Le impostazioni di rilevamento sono state scritte da una versione più recente di OpenBot, oppure il file non è leggibile. Aggiorna OpenBot per modificarle.",
  "error.provider.detectionEntryInvalid":
    "Un indirizzo deve essere un URL http:// o https:// senza password, e una cartella deve essere un percorso assoluto.",
  "error.provider.detectionEntriesTooMany": "Ci sono troppi indirizzi o cartelle.",
  "error.provider.credentialFileUnreadable": "Il file delle credenziali del provider non è leggibile.",
  "error.provider.credentialFileTooLarge": "Il file delle credenziali del provider è troppo grande.",
  "error.provider.archiveSpecialFile": "L'archivio del runtime contiene un link o un file speciale.",
  "error.provider.archiveUnsafePath": "L'archivio del runtime contiene un percorso non sicuro.",
  "error.provider.runtimeSpecialFile": "Il runtime contiene un link o un file speciale.",
  "error.provider.codexArchivePath": "L'archivio di Codex ha un percorso inatteso.",
  "error.provider.codexVersionUnexpected": "Versione del runtime di Codex inattesa.",
  "error.provider.claudeArchivePath": "L'archivio di Claude ha un percorso inatteso.",
  "error.provider.claudePackageMismatch": "Il pacchetto di Claude non corrisponde al catalogo dei runtime.",
  "error.provider.claudeChecksum": "Checksum del runtime di Claude non corrispondente.",
  "error.provider.claudeLicenseChecksum": "Checksum della licenza di Claude non corrispondente.",
  "error.provider.opencodeArchivePath": "L'archivio di OpenCode ha un percorso inatteso.",
  "error.provider.opencodePackageMismatch": "Il pacchetto di OpenCode non corrisponde al catalogo dei runtime.",
  "error.provider.opencodeChecksum": "Checksum del runtime di OpenCode non corrispondente.",
  "error.provider.opencodeLicenseChecksum": "Checksum della licenza di OpenCode non corrispondente.",
  "error.provider.grokChecksum": "Checksum del runtime di Grok non corrispondente.",
  "error.provider.grokLicenseChecksum": "Checksum della licenza di Grok non corrispondente.",
  "error.provider.grokNoticesChecksum": "Checksum delle note legali di Grok non corrispondente.",
  "error.provider.bunArchivePath": "L'archivio di Bun ha un percorso inatteso.",
  "error.provider.bunPackageMismatch": "Il pacchetto di Bun non corrisponde al catalogo dei runtime.",
  "error.provider.bunChecksum": "Checksum del runtime di Bun non corrispondente.",
  "error.provider.bunLicenseChecksum": "Checksum della licenza di Bun non corrispondente.",
  "error.provider.bunxDamaged": "Il runner del gestore di pacchetti di Bun è mancante o danneggiato.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot non è riuscito a raggiungere le fonti delle release dei provider. Controlla la connessione e riprova.",
  "error.provider.runtimesUnsupported": "I runtime dei provider non sono disponibili su questa piattaforma.",
  "error.provider.closing": "OpenBot si sta chiudendo.",
  "error.provider.removeWhileOn": "Disattiva il provider prima di rimuoverne il download.",
  "error.provider.removeWhileDownloading": "Attendi la fine del download, poi rimuovilo.",
  "error.provider.removeIncomplete": "Un programma usa alcuni file di questa CLI. Chiudilo e riprova.",
  "error.provider.cliOverride": "Rimuovi l'override esplicito del percorso della CLI prima di aggiornare da OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "L'aggiornamento del runtime non è stato completato.",
  "error.provider.downloadHttp": "Download del runtime non riuscito con HTTP {status}.",
  "error.provider.downloadNoData": "Il download del runtime non ha restituito dati.",
  "error.provider.downloadSize": "Il download del runtime ha una dimensione inattesa.",
  "error.provider.downloadIntegrity": "Il download del runtime non ha superato il controllo di integrità.",
  "error.provider.runtimeReplacing": "Impossibile installare il runtime perché un'altra istanza lo sta sostituendo.",
  "error.provider.runtimeFilesInUse":
    "Impossibile installare il runtime perché un altro programma ha aperto i suoi file. Chiudilo e riprova.",
  "error.provider.metadataHttp": "Download dei metadati del runtime non riuscito con HTTP {status}.",
  "error.provider.metadataIntegrity": "I metadati del runtime non hanno superato il controllo di integrità.",
  "error.provider.diskSpace": "Non c'è abbastanza spazio libero su disco per questo provider.",
  "error.provider.unexpectedVersion": "Il runtime del provider ha restituito una versione inattesa.",
  "error.provider.metadataNoData": "Il download dei metadati del runtime non ha restituito dati.",
  "error.provider.metadataTooLarge": "I metadati del runtime sono troppo grandi.",
  "error.provider.requestFailed": "OpenBot non è riuscito a scaricare {url}. {reason}",
  "error.provider.installRecordMismatch": "Il registro di installazione del runtime non corrisponde.",
  "error.provider.runtimeChecksum": "Checksum del runtime del provider non corrispondente.",
  "error.provider.codexReleaseShape": "La release di Codex ha una struttura inattesa.",
  "error.provider.codexReleaseNoDownload": "La release di Codex non ha un download verificabile per questo computer.",
  "error.provider.claudeReleaseShape": "La release di Claude ha una struttura inattesa.",
  "error.provider.grokReleaseVersion": "La release di Grok ha una versione inattesa.",
  "error.provider.blockedListShape": "L'elenco delle versioni bloccate ha una struttura inattesa.",
  "error.provider.releaseNoDownload": "La release di {name} non ha un download verificabile.",
  "error.provider.releaseSizeUnknown": "Il download della release non ha una dimensione nota.",
  "error.provider.releaseMetadataNotObject": "I metadati della release non sono un oggetto JSON.",
  "error.provider.releaseCheckHttp": "Il controllo della release non è riuscito con HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "I metadati della release sono troppo grandi.",
  "error.provider.idInvalid": "L'ID di un provider deve contenere lettere minuscole, cifre, `-` o `_`.",
  "error.provider.baseUrlInvalid": "L'URL di base non è un URL.",
  "error.provider.baseUrlProtocol": "L'URL di base deve iniziare con http:// o https://.",
  "error.provider.baseUrlCredentials":
    "L'URL di base non deve contenere nome utente o password. Metti la credenziale in un header.",
  "error.provider.modelsRequired": "Serve almeno un modello.",
  "error.provider.modelsTooMany": "Ci sono troppi modelli.",
  "error.provider.modelIdCharacter": "L'ID di un modello contiene un carattere non utilizzabile.",
  "error.provider.modelIdDuplicate": "Due modelli hanno lo stesso ID.",
  "error.provider.contextWindowInvalid":
    "La finestra di contesto di un modello deve essere un numero intero di token tra {min} e {max}.",
  "error.provider.headersTooMany": "Ci sono troppi header.",
  "error.provider.headerNameCharacter": "Il nome di un header contiene un carattere non consentito da HTTP.",
  "error.provider.headerNameTooLong": "Il nome di un header è troppo lungo.",
  "error.provider.headerNameDuplicate": "Due header hanno lo stesso nome.",
  "error.provider.headerValueInvalid": "Il valore di un header manca o è troppo lungo.",
  "error.provider.headerValueMissing": "Inserisci un valore per l'header {name}.",
  "error.provider.apiKeyTooLong": "La chiave API è troppo lunga.",
  "error.provider.localOnly": "I provider si possono modificare solo sul computer che esegue gli agenti.",
  "error.provider.keyRequired": "Serve una chiave del provider.",
  "error.provider.keyTooLong": "La chiave del provider è troppo lunga.",
  "error.provider.keyInvalidCharacters":
    "La chiave del provider contiene uno spazio o un carattere che una chiave non può contenere.",
  "error.provider.noModel": "Il provider selezionato non ha modelli disponibili.",
  "error.provider.noModelNamed": "{provider} non ha modelli disponibili.",
  "error.provider.acpNoModels":
    "La CLI ACP non ha annunciato nessun modello ACP. OpenBot non sceglierà un modello di ripiego a caso.",
  "error.provider.endpointRemoveBusy":
    "Attendi che il turno attivo e la coda finiscano prima di rimuovere questo endpoint.",
  "error.provider.codexOutdated":
    "La CLI di Codex {version} è troppo vecchia. OpenBot richiede la 0.156.0 o successiva.",
  "error.provider.codexNotStarted": "La CLI di Codex è stata trovata ma non è stato possibile avviarla.",
  "error.provider.codexNotStartedHint":
    "La CLI di Codex è stata trovata ma non è stato possibile avviarla. Esegui `codex --version` in un nuovo terminale.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT è stato scaricato ma non è stato possibile avviarlo. Scaricalo di nuovo in OpenBot.",
  "error.provider.codexMissing": "ChatGPT non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.codexConfigIgnored": {
    one: "Codex ha ignorato {count} impostazione nella sua configurazione: {settings}. Correggila o rimuovila, oppure aggiorna Codex.",
    other:
      "Codex ha ignorato {count} impostazioni nella sua configurazione: {settings}. Correggile o rimuovile, oppure aggiorna Codex.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex ha ignorato {count} impostazione nella sua configurazione. Correggila o rimuovila, oppure aggiorna Codex.",
    other:
      "Codex ha ignorato {count} impostazioni nella sua configurazione. Correggile o rimuovile, oppure aggiorna Codex.",
  },
  "error.provider.claudeOutdated": "Claude Code {version} è troppo vecchio. OpenBot richiede la 2.1.232 o successiva.",
  "error.provider.claudeNotStarted": "La CLI di Claude è stata trovata ma non è stato possibile avviarla.",
  "error.provider.claudeNotStartedHint":
    "La CLI di Claude è stata trovata ma non è stato possibile avviarla. Esegui `claude --version` in un nuovo terminale.",
  "error.provider.claudeManagedNotStarted":
    "Claude è stato scaricato ma non è stato possibile avviarlo. Scaricalo di nuovo in OpenBot.",
  "error.provider.claudeMissing": "Claude non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.grokOutdated": "La CLI di Grok {version} è troppo vecchia. OpenBot richiede la 1.0.5 o successiva.",
  "error.provider.grokNotStarted": "La CLI di Grok è stata trovata ma non è stato possibile avviarla.",
  "error.provider.grokNotStartedHint":
    "La CLI di Grok è stata trovata ma non è stato possibile avviarla. Esegui `grok --version` in un nuovo terminale.",
  "error.provider.grokMissing": "Grok non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.opencodeNotStarted": "Impossibile avviare OpenCode. Esegui `opencode --version` in un terminale.",
  "error.provider.opencodeMissing": "OpenCode non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.codexVersionUnreadable": "Impossibile leggere la versione della CLI di Codex.",
  "error.provider.claudeVersionUnreadable": "Impossibile leggere la versione della CLI di Claude.",
  "error.provider.grokVersionUnreadable": "Impossibile leggere la versione della CLI di Grok.",
  "error.provider.opencodeVersionUnreadable": "Impossibile leggere la versione della CLI di OpenCode.",
  "error.provider.bunVersionUnreadable": "Impossibile leggere la versione del runtime di Bun.",
  "error.provider.connectBeforeProfile": "Connetti il provider selezionato prima di generare un profilo.",
  "error.provider.cliNotReady": "La CLI di {provider} non è pronta o non ha effettuato l'accesso.",
  "error.provider.cliTimedOut":
    "{provider} non ha risposto in tempo. Il computer potrebbe essere occupato. OpenBot riproverà.",
  "error.provider.cliTimedOutRefresh":
    "{provider} non ha risposto in tempo. Il computer potrebbe essere occupato. Aggiorna i provider per riprovare.",
  "error.provider.acpStartTimedOut":
    "{provider} non ha finito di avviarsi entro {seconds} s. Il computer potrebbe essere occupato.",
  "error.provider.acpModelsTimedOut":
    "{provider} non ha elencato i suoi modelli entro {seconds} s. Il computer potrebbe essere occupato.",
  "error.provider.startStopped":
    "{provider} non si è avviato più volte di seguito, quindi OpenBot ha smesso di provare. Aggiorna i provider per riprovare.",
  "error.provider.tempDiskSpace":
    "{provider} ha bisogno di almeno 1 GB di spazio libero su disco per avviarsi. Libera spazio, poi aggiorna i provider.",
  "error.provider.noCodeSignIn": "Non si può accedere a {provider} con un codice.",
  "error.provider.codeLoginNoLink": "Il provider non ha mostrato un link di accesso. Riprova.",
  "error.provider.hostSignInEnded": "{provider} non ha completato l'accesso. Riprova.",
  "error.provider.codeLoginNotWaiting": "Nessun accesso è in attesa di un codice. Riavvia l'accesso.",
  "error.provider.codeLoginBadCode": "Incolla il codice mostrato dalla pagina di accesso.",
  "error.provider.codeLoginRefused": "Il provider non ha accettato il codice. Riavvia l'accesso.",
  "error.provider.codeLoginUnsupported":
    "Questo server non supporta l'accesso con un codice incollato. Accedi sul computer del server, nel suo browser.",
  "error.provider.cliBusyRetry": "La CLI di {provider} sta lavorando a un turno. Attendi che finisca, poi riprova.",
  "error.provider.cliSigningIn":
    "La CLI di {provider} sta effettuando l'accesso. Completa o annulla l'accesso, poi aggiorna.",
  "error.provider.cliBusyUpdate": "La CLI di {provider} sta lavorando a un turno. Attendi che finisca, poi aggiorna.",
  "error.provider.cliSelectFailed": "OpenBot non è riuscito a selezionare la CLI gestita installata.",
  "error.provider.noAuthenticatedAccount": "{provider} non ha restituito un account autenticato.",
  "error.provider.signInExpired": "L'accesso a {provider} è scaduto. Accedi di nuovo per continuare.",
  "error.provider.cliActivateFailed": "OpenBot non è riuscito ad attivare la CLI gestita.",
  "error.provider.cliBusyReconnect":
    "La CLI di {provider} sta lavorando a un turno. Attendi che finisca, poi riconnetti.",
  "error.provider.cliBusySignOut": "La CLI {provider} sta elaborando un turno. Attendi che finisca, poi disconnetti.",
  "error.provider.opencodeCredentialsRejected":
    "Il provider del modello ha rifiutato la chiave API. Correggi la chiave di OpenCode in Impostazioni, oppure la chiave del provider con `opencode auth login`. Poi riprova o scegli un altro modello.\n{detail}",
  "error.provider.opencodeAuthRequired":
    'OpenCode non ha un accesso per il provider del modello "{provider}". Scegli un modello con l\'etichetta Gratuito, oppure collega il provider: incolla una chiave OpenCode Go nelle impostazioni di OpenCode, oppure esegui `opencode auth login` in un terminale. Poi riprova.',
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode non ha un accesso per il provider di questo modello. Scegli un modello con l'etichetta Gratuito, oppure collega il provider: incolla una chiave OpenCode Go nelle impostazioni di OpenCode, oppure esegui `opencode auth login` in un terminale. Poi riprova.",
  "error.provider.opencodeKeyExpired":
    "La tua chiave API di OpenCode è scaduta. Crea una nuova chiave in OpenCode Console, incollala nelle impostazioni di OpenCode, poi riprova.",
  "error.provider.opencodeServiceFailure":
    "OpenCode non ha potuto completare questo turno perché il suo servizio locale è andato in errore. Riprova. Se l'errore continua, riconnetti OpenCode in Impostazioni.",
  "error.provider.opencodeRateLimited":
    "Il provider del modello ha rifiutato la richiesta per via del limite di richieste. Attendi qualche minuto o scegli un altro modello, poi riprova.\n{detail}",
  "error.provider.opencodeBilling":
    "Il provider del modello ha rifiutato la richiesta per via della fatturazione dell'account. Aspettare non risolve. Aggiungi un metodo di pagamento o dei fondi nell'account del provider, oppure scegli un altro modello.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "Il provider del modello di OpenCode ha segnalato una richiesta di caricamento non valida. Scegli un altro modello e continua. Controlla le routine salvate prima di ricrearle.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Questo modello non può leggere un file o un'immagine in questa chat. Scegli un modello che legge i file, poi invia di nuovo il messaggio.",
  "error.provider.opencodeFreeLimit":
    "I modelli gratuiti di OpenCode hanno raggiunto il limite di utilizzo. Tutti i modelli gratuiti condividono questo limite. Per continuare, incolla una chiave OpenCode Go nelle impostazioni di OpenCode, oppure scegli un modello di un altro provider.",
  "error.provider.opencodeProviderFailed":
    "Il provider del modello è andato in errore dal suo lato. La tua connessione non c'entra. Riprova più tardi o scegli un altro modello.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode non è riuscito a connettersi al provider del modello. Controlla la connessione di rete del computer che esegue OpenBot, poi riprova.\n{detail}",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode non è riuscito ad aprire il suo database perché una versione più recente di OpenCode lo ha modificato. Aggiorna OpenCode alla versione 2 o successiva, poi riprova.",
  "error.provider.opencodeNoAnswer":
    "Il modello OpenCode ha terminato il turno senza risposta. Riprova o scegli un altro modello.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Il modello OpenCode ha terminato il turno dopo il ragionamento, senza risposta. Riprova o scegli un altro modello.",
  "error.provider.chatgptPageFailed": "OpenBot non è riuscito ad aprire la pagina di connessione di ChatGPT.",
  "error.provider.noneReady": "Nessun provider di agenti è pronto.",
  "error.provider.claudeTurnActive": "Attendi il turno attivo di Claude prima di aggiornare il suo contesto.",
  "error.provider.codexLoginRequired": "Codex richiede l'accesso con un abbonamento ChatGPT. Esegui `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot non è riuscito ad aggiornare la CLI di {provider}. {reason}",
  "error.provider.tryAgain": "Riprova.",
  "error.provider.noAgentProcess": "{provider} non ha nessun processo in esecuzione per questo agente.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} si è fermato prima che partisse il processo dell'agente.",
  "error.provider.archiveUnreadable": "L'archivio del runtime non è leggibile o usa un formato non supportato.",
  "error.provider.antigravityArchivePath": "L'archivio di Gemini contiene un file inatteso.",
  "error.provider.antigravityChecksum": "Checksum del runtime di Gemini non corrispondente.",
  "error.provider.antigravityReleaseShape": "La release di Gemini ha una struttura inattesa.",
  "error.provider.antigravityMissing": "Gemini non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.antigravityNotStarted":
    "Il server di Gemini è stato trovato, ma non è possibile leggerne la versione.",
  "error.provider.antigravityVersionUnreadable": "Impossibile leggere la versione del server di Gemini.",
  "error.provider.antigravitySignIn": "Accedi con Google per usare Gemini.",
  "error.provider.antigravityRateLimited":
    "Gemini ha rifiutato la richiesta perché è stato raggiunto un limite di richieste o la quota del piano. Attendi qualche minuto o scegli un altro modello, poi riprova.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google segnala che è stato raggiunto un limite di utilizzo di Gemini. Il limite può valere per un solo modello, quindi la pagina di utilizzo del piano può mostrare altro disponibile. Scegli un altro modello Gemini o attendi il ripristino.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini non può usare questo modello al momento. Scegli un altro modello, poi riprova.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Il servizio Gemini di Google non ha completato la richiesta. Riprova tra qualche minuto.\n{detail}",
  "error.provider.cursorArchivePath": "L'archivio di Cursor contiene un file inatteso.",
  "error.provider.cursorChecksum": "Checksum del runtime di Cursor non corrispondente.",
  "error.provider.cursorReleaseShape": "La release di Cursor ha una struttura inattesa.",
  "error.provider.cursorMissing": "Cursor non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.cursorNotStarted": "L'agente di Cursor è stato trovato, ma non è possibile leggerne la versione.",
  "error.provider.cursorVersionUnreadable": "Impossibile leggere la versione dell'agente di Cursor.",
  "error.provider.cursorSignIn": "Accedi con Cursor o imposta CURSOR_API_KEY per usare Cursor.",
  "error.provider.clineArchivePath": "L'archivio di Cline ha un percorso inatteso.",
  "error.provider.clinePackageMismatch": "Il pacchetto di Cline non corrisponde al catalogo dei runtime.",
  "error.provider.clineChecksum": "Checksum del runtime di Cline non corrispondente.",
  "error.provider.clineLicenseChecksum": "Checksum della licenza di Cline non corrispondente.",
  "error.provider.clineMissing": "Cline non è scaricato. Scaricalo in OpenBot per continuare.",
  "error.provider.clineOutdated":
    "La CLI di Cline {version} è troppo vecchia. OpenBot richiede la 3.0.68 o successiva.",
  "error.provider.clineNotStarted": "Impossibile avviare Cline. Esegui `cline --version` in un terminale.",
  "error.provider.clineVersionUnreadable": "Impossibile leggere la versione della CLI di Cline.",
  "error.provider.clineSignIn": "Accedi con Cline o imposta CLINE_API_KEY per usare Cline.",
  "error.provider.usageLimitReached": "L'account ha raggiunto il limite di utilizzo.",
  "error.provider.foreignReasoning":
    "{provider} non ha accettato il ragionamento precedente in questa chat, perché lo ha ricevuto un altro account o un'altra chiave API. OpenBot ha avviato una nuova sessione di {provider} con la cronologia della chat. Riprova.",
  "error.provider.opencodeSessionRejected":
    "OpenCode ha rifiutato la richiesta senza indicarne la causa. Può succedere in una chat lunga o dopo un cambio di modello. OpenBot ha avviato una nuova sessione OpenCode con la cronologia della chat. Riprova. Se l’errore continua, scegli un altro modello o un impegno minore.",
  "error.provider.museMcpStartupFault":
    "Muse non è riuscito ad avviare un server MCP e ha bloccato MCP in questa sessione. OpenBot ha avviato una nuova sessione Muse con la cronologia della chat. Riprova. Se l’errore continua, disattiva Controllo del computer o il server MCP non riuscito per questo agente.",
  "error.provider.grokSignIn": "Esegui `grok login` o imposta XAI_API_KEY per usare Grok.",
  "error.provider.acpSignInTimedOut": "L'accesso è scaduto.",
  "error.provider.acpSignInStopped": "L'accesso si è interrotto prima di essere completato.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini non è riuscito ad aprire la pagina di accesso. Installa un browser e xdg-utils, poi connettiti da una sessione desktop su questo host. Un server senza desktop non può completare questo accesso.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini non è riuscito ad aprire la pagina di accesso nel browser. Controlla il browser predefinito, poi connettiti di nuovo.",
  "error.provider.acpSignInFailed": "L'accesso non è stato completato.",
  "error.provider.acpSignInFailedReason": "L'accesso non è stato completato: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Questo provider non offre questo metodo di accesso su questo computer. Aggiorna il provider, poi riprova.",
  "error.provider.httpsSignInLinkOnly": "Solo i link di accesso HTTPS possono aprirsi nel browser.",
  "error.provider.geminiKeyRefused":
    "Gemini ha rifiutato la chiave API salvata. Sostituisci o rimuovi la chiave nelle Impostazioni, poi connettiti di nuovo.",
  "error.provider.keyProviderRefused":
    "{provider} ha rifiutato la chiave API salvata. Sostituisci o rimuovi la chiave nelle Impostazioni, poi riprova.",
  "error.provider.keyProviderNoBalance":
    "L’account {provider} della chiave API salvata non ha credito. Aggiungi credito all’account, poi riprova.",
  "error.provider.messageTooLarge":
    "OpenBot ha fermato {provider} perché ha inviato un messaggio più grande di {limit} MB.",
  "error.provider.customAgentIdInvalid":
    "L'ID di un agente deve contenere lettere minuscole, cifre o `-`, e non può essere l'ID di un provider integrato.",
  "error.provider.customAgentEnvInvalid":
    "Il nome di una variabile deve contenere lettere, cifre o `_` e non può iniziare con una cifra. Usa ogni nome una sola volta, al massimo 16 nomi.",
  "error.provider.customAgentUsagePromptInvalid":
    "Un comando di utilizzo deve essere una sola riga di massimo 256 caratteri.",
  "error.provider.customAgentCommandInvalid":
    "Il comando deve essere un percorso completo, un percorso che inizia con ~/, oppure il nome di un comando senza spazi.",
  "error.provider.customAgentArgsInvalid": "Un argomento non può contenere un a capo. Usa al massimo 32 argomenti.",
  "error.provider.customAgentWindowsScript":
    "Un comando .cmd o .bat può contenere nei suoi argomenti solo lettere, numeri e - _ . , : = @ + / \\.",
  "error.provider.customAgentNotFound": "OpenBot non trova {command}. Inserisci il percorso completo del comando.",
  "error.provider.customAgentCheckTimedOut": "L'agente non ha risposto entro 20 secondi.",
  "error.provider.customAgentCheckStopped": "L'agente si è fermato prima di rispondere.",
  "error.provider.customAgentProtocolVersion": "L'agente usa la versione {version} di ACP. OpenBot usa la versione 1.",
  "error.provider.customAgentCheckFailed": "L'agente non ha risposto come un agente ACP.",
  "error.provider.customAgentRemoveBusy":
    "Attendi che il turno attivo e la coda finiscano prima di rimuovere questo agente personalizzato.",
  "error.provider.customAgentNone": "Nessun agente personalizzato salvato.",
  "error.provider.customAgentMissing": "Questo agente personalizzato non è più salvato. Scegli un altro modello.",
  "error.provider.customAgentSignIn": "Accedi con il comando dell'agente stesso, poi riprova.",
  "error.provider.customAgentsReadOnly":
    "Gli agenti personalizzati salvati sono stati scritti da una versione più recente di OpenBot, oppure il file non è leggibile. Aggiorna OpenBot per modificarli.",
  "error.provider.customAgentNoSecureStorage":
    "Questo computer non ha un archivio sicuro, quindi non si possono salvare i valori d'ambiente. Rimuovili e riprova.",
  "error.provider.customAgentNotSaved": "Questo agente personalizzato non è salvato. Aggiorna l'elenco e riprova.",
  "error.provider.customAgentTooMany": "Puoi salvare al massimo {count} agenti personalizzati.",
  "error.provider.customAgentEnvValueMissing": "Inserisci un valore per {name}.",
  "error.provider.off": "{provider} è disattivato in OpenBot. Attivalo prima nelle impostazioni dei provider.",
  "error.provider.inUse": "Un agente usa {provider}. Cambia il suo modello prima di disattivare questo provider.",
  "error.provider.useBusy": "Attendi che il controllo del provider o l'accesso finisca, poi riprova.",
  "error.provider.useSettingsReadOnly":
    "Le impostazioni salvate dei provider non sono leggibili. Aggiorna OpenBot prima di modificarle.",
  "error.provider.useChangeFailed": "OpenBot non è riuscito a modificare l'impostazione del provider.",
  "error.provider.accountsUnsupported": "{provider} può avere un solo account.",
  "error.provider.accountNeedsConnection": "Connetti {provider} prima di aggiungere un altro account.",
  "error.provider.usageResetUnsupported": "{provider} non può azzerare i limiti di utilizzo.",
  "error.provider.signOutUnsupported": "OpenBot non può disconnettere l'accesso a {provider}.",
  "error.provider.usageResetNotConnected": "Accedi di nuovo a questo account {provider} prima di azzerarne l'utilizzo.",
  "error.provider.accountLimit": "{provider} può avere al massimo {limit} account.",
  "error.provider.accountNotFound": "Questo account {provider} non è su questo computer. Aggiorna e riprova.",
  "error.provider.accountAlreadyAdded": "Questo account {provider} è già connesso.",
  "error.provider.accountDefault": "Il primo account {provider} non può essere rimosso.",
  "error.provider.accountUsesKey":
    "Questo account {provider} usa la chiave API salvata e non ha un accesso. Cambia la chiave in Impostazioni server → Provider.",
  "error.provider.accountInUse": "Un agente che usa questo account è al lavoro. Riprova quando l'agente si ferma.",
  "error.provider.accountsReadOnly":
    "Gli account salvati dei provider non sono leggibili. Aggiorna OpenBot prima di modificarli.",
  "error.provider.accountSignedOut": "Hai effettuato l'uscita da questo account {provider}. Accedi di nuovo.",
  "error.provider.sessionSettingUnavailable":
    "Questa impostazione non è disponibile nella sessione attuale del provider.",
  "error.provider.sessionSettingInvalid": "Questo valore non è disponibile per l'impostazione.",
  "error.provider.sessionSettingsBusy":
    "Attendi che il turno attuale finisca prima di cambiare un'impostazione della sessione.",
  "error.provider.piOutdated":
    "Pi {version} è troppo vecchio. Installa Pi 1.1.0 o successivo per il supporto nativo a RPC e MCP.",
  "error.provider.nativeMissing": "La CLI di {provider} non è installata. Scaricala in Impostazioni.",
  "error.provider.nativeNotStarted": "Impossibile avviare la CLI di {provider}.",
  "error.provider.nativeVersionUnreadable": "Impossibile leggere la versione della CLI di {provider}.",
  "error.provider.piSessionBusy": "Attendi che il turno attuale di Pi finisca.",
  "error.provider.piStopped": "Pi non è in esecuzione. Connetti Pi e riprova.",
  "error.provider.piSessionMissing": "Il file della sessione di Pi non è disponibile su questo computer.",
  "error.provider.piResumeCancelled": "Pi ha annullato la ripresa della sessione. Riprova.",
  "error.provider.piSessionIdentity":
    "Pi ha restituito una sessione diversa. La sessione salvata non è stata sostituita.",
  "error.provider.piModelInvalid": "Seleziona un modello di Pi che includa il suo provider.",
  "error.provider.piToolInvalid": "Il tool ha restituito un risultato non valido.",
  "error.provider.piSignIn": "Usa /login in Pi sul computer host. Chiudi Pi quando l'accesso è completato.",
  "error.provider.museBusy": "La sessione di Muse è occupata.",
  "error.provider.museStopped": "Il client di Muse non è in esecuzione.",
  "error.provider.museUnexpectedProvider": "Muse ha restituito un provider di modelli inatteso.",
  "error.provider.museNoActiveTurn": "Muse non ha nessun turno attivo da indirizzare.",
  "error.provider.museInvalidProtocol": "Muse ha restituito una risposta di protocollo non valida.",
  "error.provider.museNotStarted": "Muse non si è avviato.",
  "error.provider.museNativeWindows": "Muse richiede un eseguibile nativo su Windows.",
  "error.provider.museStartTimeout": "L'inizializzazione di Muse è scaduta.",
  "error.provider.museStartStopped": "Muse si è fermato durante l'inizializzazione.",
  "error.provider.museProtocolVersion": "Versione del protocollo di Muse non supportata.",
  "error.provider.museHistoryRequired": "Muse deve conservare la cronologia della sessione.",
  "error.provider.museRequestUnsupported": "Richiesta del server di Muse non supportata.",
  "error.provider.museConnectionFailed":
    "Connessione a Muse non riuscita. Riprendi la conversazione per recuperare la sua cronologia salvata.",
  "error.provider.museUnknownSession": "Sessione di Muse sconosciuta.",
  "error.provider.museInvalidToolResult": "Risultato del tool di OpenBot non valido.",
  "error.provider.museMcpRequired": "Muse deve supportare i server MCP di sessione.",
  "error.provider.museSessionMismatch": "Muse ha restituito una sessione diversa.",
  "error.provider.museCompactRejected": "Muse non ha accettato la compattazione.",
  "error.provider.museTurnMismatch": "Muse ha restituito un turno diverso.",
  "error.provider.museHistoryMismatch": "La cronologia di Muse ha attraversato più sessioni.",
  "error.provider.museRecoveryFailed": "Muse non è riuscito a recuperare gli eventi mancanti.",
  "error.provider.museHistoryStalled": "Il cursore della cronologia di Muse non è avanzato.",
  "error.provider.museApprovalUnavailable": "Muse non ha offerto questa risposta di approvazione.",
  "error.provider.museHistoryOwner": "La cronologia di Muse appartiene a un'altra sessione.",
  "error.provider.museHistoryMissing": "Muse non ha restituito la cronologia della sessione.",
  "error.provider.museEmptyInput": "Muse ha bisogno di testo o di un'immagine.",
  "error.provider.museMethodUnsupported": "Muse non supporta {method}.",
  "error.provider.museTurnFailed": "Turno di Muse non riuscito.",
  "error.provider.museProfileUnsupported":
    "Muse non può generare un profilo senza accesso a tool esterni. Usa un altro provider per generare il profilo, poi seleziona Muse per l'agente.",
  "error.provider.museAuthUnverified":
    "L'autenticazione di Muse non è verificata. Connettiti sul computer host, oppure imposta una chiave API di Meta.",
  "error.provider.museSignIn": "Per continuare, accedi a Muse sul computer host.",
  "error.provider.inceptionSignIn": "Per continuare, aggiungi una chiave API di Inception.",
  "error.provider.deepseekSignIn": "Aggiungi una chiave API di DeepSeek per continuare.",
  "error.provider.openrouterSignIn": "Aggiungi una chiave API di OpenRouter per continuare.",
  "error.provider.terminalLoginFailed":
    "Impossibile aprire il terminale di accesso. Apri la CLI del provider su questo host e accedi da lì, poi aggiorna i provider.",
  "error.provider.nativeArchiveInvalid": "Il download del provider non contiene un'installazione valida.",
  "error.provider.nativeChecksum": "L'installazione del provider non ha superato il controllo di integrità.",
  "error.provider.registryUnavailable": "Il registro ACP non è disponibile. Riprova.",
  "error.provider.registryInvalid": "Il registro ACP ha restituito dati non validi.",
  "error.provider.registryMissing": "Questo agente non è nel registro ACP.",
  "error.provider.registryBusy": "È già in corso un'installazione per questo agente.",
  "error.provider.registryCancelled": "L'installazione dell'agente è stata annullata.",
  "error.provider.registryPrerequisite": "Installa {tool} sull'host prima di installare questo agente.",
  "error.provider.registryBindingChanged": "L'agente personalizzato è cambiato durante l'installazione. Riprova.",
  "error.provider.registryInstallFailed":
    "Installazione dell'agente non riuscita. L'installazione precedente è invariata.",
  "error.provider.registryRemoveBusy":
    "Attendi che l'installazione dell'agente e il lavoro ACP attivo finiscano prima di rimuoverlo.",
} as const satisfies PartialTranslation<typeof source>;
