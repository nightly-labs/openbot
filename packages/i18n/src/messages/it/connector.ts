import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Ogni agente su questo computer può usare i tuoi repository, issue e pull request GitHub, oltre a gh e git.",
  "connector.github.connect": "Connetti GitHub",
  "connector.github.pendingTitle": "Digita questo codice su GitHub",
  "connector.github.pendingDescription": "GitHub si è aperto nel browser. Digita lì il codice per connetterti.",
  "connector.github.waiting": "In attesa di GitHub",
  "connector.github.copyCode": "Copia il codice",
  "connector.github.codeCopied": "Copiato",
  "connector.github.openGitHub": "Apri GitHub",
  "connector.github.cancel": "Annulla",
  "connector.github.connectedAs": "Connesso come @{login}",
  "connector.github.repositoriesTitle": "Repository",
  "connector.github.repositoriesDescription":
    "Gli agenti possono usare solo i repository in cui è installata la GitHub App di OpenBot.",
  "connector.github.chooseRepositories": "Scegli i repository",
  "connector.github.repositoriesLoading": "Lettura dei repository da GitHub",
  "connector.github.repositoriesFailed": "OpenBot non è riuscito a leggere i repository da GitHub.",
  "connector.github.noRepositories": "La GitHub App di OpenBot non è ancora installata su nessun repository.",
  "connector.github.moreRepositories": { one: "E {count} altro repository", other: "E altri {count} repository" },
  "connector.github.private": "Privato",
  "connector.github.disconnect": "Disconnetti",
  "connector.github.disconnectTitle": "Disconnetti GitHub",
  "connector.github.disconnectSummary": "Ogni agente perde GitHub. Le tue chat e i tuoi file restano.",
  "connector.github.expiredTitle": "La connessione a GitHub è scaduta",
  "connector.github.expiredDescription": "Connettiti di nuovo come @{login} per ridare GitHub agli agenti.",
  "connector.github.reconnect": "Riconnetti",
  "connector.github.actionFailed": "OpenBot non è riuscito a cambiare la connessione a GitHub.",
  "connector.github.statusConnected": "Connesso",
  "connector.github.statusConnecting": "Connessione",
  "connector.github.statusExpired": "Scaduto",
  "connector.github.accountTitle": "Account",
  "connector.github.filterPlaceholder": { one: "Filtra {count} repository", other: "Filtra {count} repository" },
  "connector.github.filterLabel": "Filtra i repository",
  "connector.github.noMatch": "Nessun repository corrisponde a «{query}».",
  "connector.github.stepSignIn": "Accedi",
  "connector.github.stepConnected": "Connesso",
  "connector.github.requestingCode": "OpenBot chiede un codice a GitHub.",
  "connector.github.codeLabel": "Codice {code}",
  "connector.github.failedTitle": "GitHub non si è connesso",
  "connector.github.cancelConnecting": "Annulla la connessione a GitHub",
  "connector.github.connectedSummary": {
    one: "{count} repository · ogni agente su questo computer",
    other: "{count} repository · ogni agente su questo computer",
  },
  "connector.github.done": "Fine",
  "connector.github.later": "Più tardi",
  "connector.github.disconnectConfirmTitle": "Disconnettere GitHub?",
  "connector.github.disconnectConfirmDescription": "«Disconnetti» rimuove l'accesso di @{login} da questo computer.",
  "connector.github.disconnectEffectTools": "Ogni agente perde i tool GitHub, gh e git.",
  "connector.github.disconnectEffectRevoke": "Poi si apre GitHub, dove puoi revocare OpenBot.",
  "connector.github.disconnectEffectKept": "Chat, file e memoria degli agenti restano su questo computer.",
  "connector.github.descriptionHost":
    "Ogni agente su {host} può usare i tuoi repository, issue e pull request GitHub, oltre a gh e git.",
  "connector.github.connectedSummaryHost": {
    one: "{count} repository · ogni agente su {host}",
    other: "{count} repository · ogni agente su {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost": "«Disconnetti» rimuove l'accesso di @{login} da {host}.",
  "connector.github.disconnectEffectKeptHost": "Chat, file e memoria degli agenti restano su {host}.",
  "connector.github.keepConnected": "Resta connesso",
  "connector.github.close": "Chiudi",
  "connector.dangerZone": "Zona pericolosa",
  "connector.statusUnknown": "Sconosciuto",
  "connector.readFailed": "OpenBot non è riuscito a leggere lo stato di questa connessione.",

  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Le persone menzionano @OpenBot in Slack o gli mandano un messaggio diretto. Lo Slack Orchestrator interpella l'agente giusto e risponde.",
  "connector.slack.statusConnected": "Connesso",
  "connector.slack.statusAttention": "Richiede attenzione",
  "connector.slack.summaryConnected": "{workspace} · Lo Slack Orchestrator risponde",
  "connector.slack.summaryNoAgent": "{workspace} · Nessun agente risponde ancora",
  "connector.slack.attentionTitle": {
    one: "{count} workspace richiede attenzione",
    other: "{count} workspace richiedono attenzione",
  },
  "connector.slack.attentionDescription": "Lo stato qui sotto dice cosa fare.",
  "connector.slack.connect": "Connetti Slack",
  "connector.slack.addAgent": "Aggiungi agente",
  "connector.slack.actionFailed": "Slack non ha accettato la modifica",
  "connector.slack.workspaceTitle": "Workspace",
  "connector.slack.workspaceDescription": "Le persone menzionano @OpenBot o gli mandano un messaggio diretto.",
  "connector.slack.disconnectWorkspace": "Disconnetti",
  "connector.slack.disconnectAllTitle": "Disconnetti Slack",
  "connector.slack.disconnectAllSummary":
    "Tutti i workspace vengono disconnessi. Nessuno potrà più raggiungere i tuoi agenti tramite @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "Tutti i workspace vengono disconnessi. Lo Slack Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.slack.missingScopes":
    "OpenBot non ha questi permessi in Slack: {scopes}. Disconnetti il workspace, poi connettilo di nuovo.",
  "connector.slack.retryAt": "Slack ha chiesto a OpenBot di aspettare. Nuovo tentativo alle {time}.",
  "connector.slack.reconnect": "Riconnetti",
  "connector.slack.pause": "Pausa",
  "connector.slack.resume": "Riprendi",
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "Questo agente riceve ogni richiesta da Slack. Risponde da solo a quelle brevi, passa il resto all'agente giusto e pubblica la risposta nel thread.",
  "connector.slack.orchestratorNone": "Nessun agente risponde ancora",
  "connector.slack.orchestratorNoneDescription":
    "Aggiungi lo Slack Orchestrator, altrimenti Slack non riceve risposta.",
  "connector.slack.inviteNote":
    "OpenBot entra da solo in ogni canale pubblico, compresi i nuovi. In un canale privato invitalo: /invite @OpenBot.",
  "connector.slack.stepWorkspace": "Workspace",
  "connector.slack.stepAgent": "Agente",
  "connector.slack.connectTitle": "Connetti un workspace Slack",
  "connector.slack.connectDescription":
    "OpenBot installa nel workspace una sola app, chiamata OpenBot, che entra in ogni canale pubblico.",
  "connector.slack.connectStepBrowser": "Slack si apre nel browser",
  "connector.slack.connectStepAllow": "Seleziona il workspace in alto a destra, poi Consenti",
  "connector.slack.connectStepReturn": "Questa finestra prosegue quando Slack ha finito",
  "connector.slack.connectInSlack": "Connetti in Slack",
  "connector.slack.connectWaiting": "In attesa di Slack. Completa l'installazione nel browser.",
  "connector.slack.agentStepTitle": "Aggiungi lo Slack Orchestrator",
  "connector.slack.agentStepDescription":
    "Questo nuovo agente risponde a tutto ciò che le persone mandano a @OpenBot in {workspace}.",
  "connector.slack.orchestratorName": "Slack Orchestrator",
  "connector.slack.orchestratorRole": "Risponde in Slack e interpella il team",
  "connector.slack.orchestratorDoesReceive": "Riceve per primo ogni richiesta di Slack",
  "connector.slack.orchestratorDoesDelegate": "Affida ogni compito all'agente più adatto",
  "connector.slack.orchestratorDoesAnswer": "Pubblica la risposta nel thread di Slack",
  "connector.slack.orchestratorModel": "Modello",
  "connector.slack.doneTitle": "OpenBot è in {workspace}",
  "connector.slack.doneDescription":
    "Menziona @OpenBot in un canale pubblico qualsiasi, oppure mandagli un messaggio diretto.",
  "connector.slack.done": "Fine",
  "connector.slack.disconnectTitle": "Disconnettere {workspace}?",
  "connector.slack.disconnectDescription":
    "OpenBot smette di rispondere in {workspace} e rimuove da questo computer il suo token Slack.",
  "connector.slack.disconnectDescriptionHost":
    "OpenBot smette di rispondere in {workspace} e rimuove da {host} il suo token Slack.",
  "connector.slack.disconnectEffect":
    "Le persone in {workspace} non possono più raggiungere i tuoi agenti tramite @OpenBot.",
  "connector.slack.removeEffectKept": "Le conversazioni e lo Slack Orchestrator restano in OpenBot.",
  "connector.slack.removeEffectDeleted": "Lo Slack Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.slack.keep": "Resta connesso",
  "connector.slack.close": "Chiudi",
  "connector.slack.addWorkspace": "Aggiungi workspace",
  "connector.slack.limitReached": {
    one: "Puoi connettere al massimo {count} workspace.",
    other: "Puoi connettere al massimo {count} workspace.",
  },
  "connector.slack.summaryMany": {
    one: "{count} workspace · Lo Slack Orchestrator risponde",
    other: "{count} workspace · Lo Slack Orchestrator risponde",
  },

  "connector.discord.title": "Discord",
  "connector.discord.description":
    "Le persone menzionano @OpenBot in un canale di un server Discord. Il Discord Orchestrator interpella l'agente giusto e risponde.",
  "connector.discord.statusConnected": "Connesso",
  "connector.discord.statusAttention": "Richiede attenzione",
  "connector.discord.summaryConnected": "{workspace} · Il Discord Orchestrator risponde",
  "connector.discord.summaryNoAgent": "{workspace} · Nessun agente risponde ancora",
  "connector.discord.attentionTitle": {
    one: "{count} server Discord richiede attenzione",
    other: "{count} server Discord richiedono attenzione",
  },
  "connector.discord.attentionDescription": "Lo stato qui sotto dice cosa fare.",
  "connector.discord.connect": "Connetti Discord",
  "connector.discord.addAgent": "Aggiungi agente",
  "connector.discord.actionFailed": "Discord non ha accettato la modifica",
  "connector.discord.workspaceTitle": "Server Discord",
  "connector.discord.workspaceDescription": "Menziona @OpenBot in un canale. Rispondi a OpenBot per continuare.",
  "connector.discord.disconnectWorkspace": "Disconnetti",
  "connector.discord.disconnectAllTitle": "Disconnetti Discord",
  "connector.discord.disconnectAllSummary":
    "Tutti i server vengono disconnessi. Nessuno potrà più raggiungere i tuoi agenti tramite @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "Tutti i server vengono disconnessi. Il Discord Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.discord.missingScopes":
    "OpenBot non ha questi permessi in Discord: {scopes}. Disconnetti il server Discord, poi connettilo di nuovo.",
  "connector.discord.retryAt": "Discord ha chiesto a OpenBot di aspettare. Nuovo tentativo alle {time}.",
  "connector.discord.reconnect": "Riconnetti",
  "connector.discord.pause": "Pausa",
  "connector.discord.resume": "Riprendi",
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "Discord Orchestrator",
  "connector.discord.orchestratorDescription":
    "Questo agente riceve ogni richiesta da Discord. Risponde da solo a quelle brevi, passa il resto all'agente giusto e invia la risposta nel canale.",
  "connector.discord.orchestratorNone": "Nessun agente risponde ancora",
  "connector.discord.orchestratorNoneDescription":
    "Aggiungi il Discord Orchestrator, altrimenti Discord non riceve risposta.",
  "connector.discord.channelsNote": "OpenBot vede i canali che il suo ruolo può visualizzare.",
  "connector.discord.stepWorkspace": "Server Discord",
  "connector.discord.stepAgent": "Agente",
  "connector.discord.connectTitle": "Connetti un server Discord",
  "connector.discord.connectDescription": "OpenBot aggiunge al server Discord un solo bot, chiamato OpenBot.",
  "connector.discord.connectStepBrowser": "Discord si apre nel browser",
  "connector.discord.connectStepAllow": "Seleziona il server, poi Autorizza",
  "connector.discord.connectStepReturn": "Questa finestra prosegue quando Discord ha finito",
  "connector.discord.connectInDiscord": "Connetti in Discord",
  "connector.discord.connectWaiting": "In attesa di Discord. Completa l'autorizzazione nel browser.",
  "connector.discord.agentStepTitle": "Aggiungi il Discord Orchestrator",
  "connector.discord.agentStepDescription":
    "Questo nuovo agente risponde a tutto ciò che le persone mandano a @OpenBot in {workspace}.",
  "connector.discord.orchestratorName": "Discord Orchestrator",
  "connector.discord.orchestratorRole": "Risponde in Discord e interpella il team",
  "connector.discord.orchestratorDoesReceive": "Riceve per primo ogni richiesta di Discord",
  "connector.discord.orchestratorDoesDelegate": "Affida ogni compito all'agente più adatto",
  "connector.discord.orchestratorDoesAnswer": "Risponde nel canale Discord",
  "connector.discord.orchestratorModel": "Modello",
  "connector.discord.doneTitle": "OpenBot è in {workspace}",
  "connector.discord.doneDescription": "Menziona @OpenBot in un canale. Rispondi a OpenBot per continuare.",
  "connector.discord.done": "Fine",
  "connector.discord.disconnectTitle": "Disconnettere {workspace}?",
  "connector.discord.disconnectDescription":
    "OpenBot smette di rispondere in {workspace} e rimuove da questo computer la connessione a Discord.",
  "connector.discord.disconnectDescriptionHost":
    "OpenBot smette di rispondere in {workspace} e rimuove da {host} la connessione a Discord.",
  "connector.discord.disconnectEffect":
    "Le persone in {workspace} non possono più raggiungere i tuoi agenti tramite @OpenBot.",
  "connector.discord.removeEffectKept": "Le conversazioni e il Discord Orchestrator restano in OpenBot.",
  "connector.discord.removeEffectDeleted":
    "Il Discord Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.discord.keep": "Resta connesso",
  "connector.discord.close": "Chiudi",
  "connector.discord.addWorkspace": "Aggiungi server Discord",
  "connector.discord.limitReached": {
    one: "Puoi connettere al massimo {count} server Discord.",
    other: "Puoi connettere al massimo {count} server Discord.",
  },
  "connector.discord.summaryMany": {
    one: "{count} server Discord · Il Discord Orchestrator risponde",
    other: "{count} server Discord · Il Discord Orchestrator risponde",
  },
  "connector.discord.accessTitle": "Chi può usare OpenBot",
  "connector.discord.accessDescription": "OpenBot risponde solo a queste persone. Ignora le menzioni degli altri.",
  "connector.discord.accessEveryone": "Tutti nel server",
  "connector.discord.accessEveryoneDescription":
    "Chiunque possa scrivere in un canale che OpenBot vede può menzionarlo.",
  "connector.discord.accessRoles": "Membri con {roles}",
  "connector.discord.accessChoose": "Scegli ruoli",
  "connector.discord.accessDialogTitle": "Chi può usare OpenBot in {workspace}?",
  "connector.discord.accessDialogDescription": "Senza ruoli selezionati, tutti possono menzionare OpenBot.",
  "connector.discord.accessLoading": "Caricamento ruoli…",
  "connector.discord.accessLoadFailed": "I ruoli Discord non sono stati caricati",
  "connector.discord.accessNoRoles": "Questo server non ha ruoli da scegliere.",
  "connector.discord.accessRoleDeleted": "{role} (eliminato)",
  "connector.discord.accessSave": "Salva",
  "connector.discord.accessHostUpdate": "Aggiorna OpenBot su {host} per scegliere i ruoli.",

  "connector.telegram.title": "Telegram Bot",
  "connector.telegram.developer": "Telegram",
  "connector.telegram.description":
    "Aggiungi il bot OpenBot a un gruppo Telegram o apri una chat diretta con lui. Il Telegram Orchestrator interpella l'agente giusto e risponde.",
  "connector.telegram.statusConnected": "Connesso",
  "connector.telegram.statusAttention": "Richiede attenzione",
  "connector.telegram.summaryConnected": {
    one: "{count} chat · Il Telegram Orchestrator risponde",
    other: "{count} chat · Il Telegram Orchestrator risponde",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} chat · Nessun agente risponde ancora",
    other: "{count} chat · Nessun agente risponde ancora",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} chat richiede attenzione",
    other: "{count} chat richiedono attenzione",
  },
  "connector.telegram.attentionDescription": "Lo stato qui sotto dice cosa fare.",
  "connector.telegram.connect": "Connetti Telegram",
  "connector.telegram.addAgent": "Aggiungi agente",
  "connector.telegram.actionFailed": "Telegram non ha accettato la modifica",
  "connector.telegram.chatsTitle": "Chat",
  "connector.telegram.groupDescription": "Le persone menzionano il bot o rispondono ai suoi messaggi.",
  "connector.telegram.directDescription": "Ogni messaggio di questa chat va al Telegram Orchestrator.",
  "connector.telegram.helpRemoved":
    "Il bot OpenBot non è più in questa chat. Disconnetti la chat, poi aggiungi di nuovo il bot.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot non può ricevere i messaggi di Telegram su questo computer. Accedi, dai un nome a questo computer nelle impostazioni del server e tieni OpenBot aperto.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot su {host} non può ricevere i messaggi di Telegram. Su {host}, accedi, dai un nome al server nelle impostazioni del server e tieni OpenBot aperto.",
  "connector.telegram.helpError":
    "OpenBot non riesce a raggiungere questa chat. Riconnettiti, oppure disconnetti la chat.",
  "connector.telegram.retryAt": "Telegram ha chiesto a OpenBot di aspettare. Nuovo tentativo alle {time}.",
  "connector.telegram.pause": "Pausa",
  "connector.telegram.resume": "Riprendi",
  "connector.telegram.reconnect": "Riconnetti",
  "connector.telegram.disconnectChat": "Disconnetti",
  "connector.telegram.disconnectAllTitle": "Disconnetti Telegram",
  "connector.telegram.disconnectAllSummary":
    "Tutte le chat vengono disconnesse. Nessuno potrà più raggiungere i tuoi agenti tramite il bot OpenBot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "Tutte le chat vengono disconnesse. Il Telegram Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "Collega una chat",
  "connector.telegram.addToGroup": "Aggiungi a un gruppo",
  "connector.telegram.openDirectChat": "Apri una chat diretta",
  "connector.telegram.orchestratorTitle": "Telegram Orchestrator",
  "connector.telegram.orchestratorDescription":
    "Questo agente riceve i messaggi per OpenBot da tutte le tue chat Telegram. Risponde da solo a quelli brevi, passa il resto all'agente giusto e pubblica la risposta nella chat.",
  "connector.telegram.orchestratorNone": "Nessun agente risponde ancora",
  "connector.telegram.orchestratorNoneDescription":
    "Aggiungi il Telegram Orchestrator, altrimenti Telegram non riceve risposta.",
  "connector.telegram.mentionNote":
    "In un gruppo, menziona il bot o rispondi ai suoi messaggi. In una chat diretta, ogni messaggio va al bot.",
  "connector.telegram.stepChat": "Chat",
  "connector.telegram.stepAgent": "Agente",
  "connector.telegram.connectTitle": "Collega una chat Telegram",
  "connector.telegram.connectDescription":
    "Aggiungi il bot OpenBot a un gruppo, oppure apri una chat diretta con lui. Un solo bot serve tutte le tue chat.",
  "connector.telegram.connectStepBrowser": "Telegram si apre nel browser",
  "connector.telegram.connectStepPick": "Seleziona il gruppo, oppure premi Avvia nella chat diretta",
  "connector.telegram.connectStepReturn": "Questa finestra prosegue quando la chat è collegata",
  "connector.telegram.connectWaiting": "In attesa di Telegram. Seleziona la chat in Telegram.",
  "connector.telegram.agentStepTitle": "Aggiungi il Telegram Orchestrator",
  "connector.telegram.agentStepDescription":
    "Questo nuovo agente risponde ai messaggi per OpenBot in {chat} e in ogni chat che collegherai in seguito.",
  "connector.telegram.orchestratorName": "Telegram Orchestrator",
  "connector.telegram.orchestratorRole": "Risponde in Telegram e interpella il team",
  "connector.telegram.orchestratorDoesReceive": "Riceve per primo ogni messaggio Telegram per OpenBot",
  "connector.telegram.orchestratorDoesDelegate": "Affida ogni compito all'agente più adatto",
  "connector.telegram.orchestratorDoesAnswer": "Pubblica la risposta nella chat Telegram",
  "connector.telegram.orchestratorModel": "Modello",
  "connector.telegram.doneTitle": "OpenBot è in {chat}",
  "connector.telegram.done": "Fine",
  "connector.telegram.disconnectTitle": "Disconnettere {chat}?",
  "connector.telegram.leaveDescription": "Il bot OpenBot esce da {chat} e OpenBot smette di rispondere lì.",
  "connector.telegram.disconnectEffect":
    "Le persone in {chat} non possono più raggiungere i tuoi agenti tramite il bot OpenBot.",
  "connector.telegram.removeEffectKept": "Le conversazioni e il Telegram Orchestrator restano in OpenBot.",
  "connector.telegram.removeEffectDeleted":
    "È l’ultima chat, quindi il Telegram Orchestrator e le sue conversazioni vengono eliminati da OpenBot.",
  "connector.telegram.keep": "Resta connesso",
  "connector.telegram.close": "Chiudi",
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Condividi con OpenBot un vault 1Password dedicato tramite un account di servizio, così gli agenti possono accedere ai siti nel browser di OpenBot.",
  "connector.onePassword.howItWorks":
    "Connettendo, viene creato un vault «Condiviso con OpenBot» nel tuo account 1Password, insieme a un account di servizio che può leggere solo quel vault. OpenBot compila gli accessi salvati nel suo browser su questo computer, quindi vengono condivisi solo gli elementi che sposti in quel vault. Gli agenti non vedono mai una password.",
  "connector.onePassword.connect": "Connetti 1Password",
  "connector.onePassword.setupTitle": "Configurazione",
  "connector.onePassword.stepCliTitle": "Installa la CLI di 1Password",
  "connector.onePassword.stepCliChecking": "Ricerca della CLI di 1Password su questo computer",
  "connector.onePassword.stepCliInstalling": "Download della CLI di 1Password da 1Password",
  "connector.onePassword.stepCliReady": "La versione {version} è installata.",
  "connector.onePassword.stepCliMissing":
    "OpenBot la scarica da 1Password nella sua cartella. Non serve la password di amministratore.",
  "connector.onePassword.stepCliManual":
    "OpenBot non può installarla su questo computer. Installala da 1Password, poi torna in questa pagina.",
  "connector.onePassword.installCli": "Installa",
  "connector.onePassword.stepAppTitle": "Attiva l'integrazione con la CLI",
  "connector.onePassword.stepAppDescription":
    "Nell'app 1Password apri Impostazioni > Sviluppatore e attiva «Integra con la CLI di 1Password».",
  "connector.onePassword.stepAppReady": "L'app 1Password permette alla CLI di creare il vault condiviso.",
  "connector.onePassword.openApp": "Apri 1Password",
  "connector.onePassword.openAppFailed": "OpenBot non è riuscito ad aprire 1Password.",
  "connector.onePassword.checkAgain": "Ricontrolla",
  "connector.onePassword.stepVaultTitle": "Crea il vault condiviso",
  "connector.onePassword.stepVaultDescription":
    "OpenBot crea il vault «Shared with OpenBot» e un account di servizio che può solo leggerlo. 1Password ti chiede di approvare.",
  "connector.onePassword.useTokenDescription":
    "Invece di questi passaggi, incolla un token dell'account di servizio da 1Password.com.",
  "connector.onePassword.useTokenAction": "Usa token",
  "connector.onePassword.tokenLabel": "Token dell'account di servizio",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Connetti",
  "connector.onePassword.approveInApp": "Approva la richiesta nell'app 1Password",
  "connector.onePassword.cancel": "Annulla",
  "connector.onePassword.chooseAccountTitle": "Scegli un account",
  "connector.onePassword.chooseAccountDescription": "OpenBot crea il vault condiviso nell'account che scegli.",
  "connector.onePassword.useAccount": "Usa questo account",
  "connector.onePassword.vaultTitle": "Vault condiviso",
  "connector.onePassword.vaultDescription":
    "Sposta un accesso in questo vault in 1Password per permettere agli agenti di usarlo. Rimuovilo per smettere.",
  "connector.onePassword.loginsLoading": "Lettura degli accessi da 1Password",
  "connector.onePassword.loginCount": { one: "{count} accesso", other: "{count} accessi" },
  "connector.onePassword.disconnect": "Disconnetti",
  "connector.onePassword.disconnectTitle": "Disconnetti 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot dimentica il token. Il vault e l'account di servizio restano in 1Password: rimuovili lì se non ti servono più.",
  "connector.onePassword.actionFailed": "OpenBot non è riuscito a cambiare la connessione a 1Password.",
  "connector.onePassword.statusConnected": "Connesso",
  "connector.onePassword.statusConnecting": "Connessione",
  "connector.onePassword.descriptionHost":
    "Condividi con OpenBot su {host} un vault 1Password dedicato tramite un account di servizio, così gli agenti su {host} possono accedere ai siti nel suo browser.",
  "connector.onePassword.howItWorksHost":
    "{host} si connette con un token di account di servizio. Su 1Password.com, crea un account di servizio che può leggere solo il vault che condividi con OpenBot, poi incolla qui il suo token. {host} verifica il token e lo conserva; questo computer no. Gli agenti non vedono mai una password.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} dimentica il token. Il vault e l'account di servizio restano in 1Password: rimuovili lì se non ti servono più.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Compila gli accessi del browser da Bitwarden.",
  "connector.bitwarden.setup":
    "Installa la CLI di Bitwarden e accedi con bw login. Crea una cartella chiamata Shared with OpenBot e mettici solo gli accessi che gli agenti possono usare. Esegui bw unlock --raw e incolla qui sotto la chiave di sessione. Non incollare la tua password principale.",
  "connector.bitwarden.scope":
    "Tutti gli agenti su questo computer possono usare gli accessi corrispondenti in Shared with OpenBot. OpenBot usa origini HTTPS esatte. Non usa gli elementi che richiedono la password principale o una regola di corrispondenza URI personalizzata.",
  "connector.bitwarden.session":
    "La chiave di sessione resta in memoria. Connettiti di nuovo dopo 8 ore senza uso del vault o dopo l'uscita da OpenBot. «Disconnetti» interrompe l'accesso di OpenBot; non blocca gli altri client Bitwarden.",
  "connector.bitwarden.sessionKey": "Chiave di sessione Bitwarden",
  "connector.bitwarden.connect": "Connetti Bitwarden",
  "connector.bitwarden.disconnect": "Disconnetti Bitwarden",
  "connector.bitwarden.disconnectAction": "Disconnetti",
  "connector.bitwarden.disconnectSummary":
    "OpenBot dimentica la chiave di sessione. Gli agenti non possono più compilare gli accessi da Bitwarden. Gli altri client Bitwarden restano sbloccati.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} rimuove la chiave API e la password principale. Gli agenti su {host} non possono più compilare gli accessi da Bitwarden.",
  "connector.bitwarden.connected": "Connesso",
  "connector.bitwarden.actionFailed": "OpenBot non è riuscito a cambiare la connessione a Bitwarden.",
  "connector.bitwarden.descriptionHost": "Compila gli accessi del browser su {host} da Bitwarden o Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} accede con la propria CLI di Bitwarden. Nella tua cassaforte, crea una cartella chiamata Shared with OpenBot e mettici solo gli accessi che gli agenti possono usare. Nella cassaforte web, apri Impostazioni › Sicurezza › Chiavi e mostra la tua chiave API. Inserisci qui sotto l’indirizzo del server, client_id, client_secret e la tua password principale.",
  "connector.bitwarden.scopeHost":
    "Tutti gli agenti su {host} possono usare gli accessi corrispondenti in Shared with OpenBot. OpenBot usa origini HTTPS esatte. Non usa elementi che chiedono la password principale o che hanno una regola di corrispondenza URI personalizzata.",
  "connector.bitwarden.sessionHost":
    "{host} conserva la chiave API e la password principale cifrate, così può sbloccare di nuovo dopo un riavvio. Questo computer non le conserva. Disconnetti le rimuove da {host}. {host} deve raggiungere l’indirizzo del server tramite HTTPS.",
  "connector.bitwarden.serverUrl": "Indirizzo del server",
  "connector.bitwarden.folderTitle": "Cartella condivisa",
  "connector.bitwarden.folderDescription":
    "Sposta un accesso in questa cartella in Bitwarden per permettere agli agenti di usarlo. Rimuovilo per smettere.",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Cartella in Bitwarden",
  "connector.bitwarden.clientId": "client_id della chiave API",
  "connector.bitwarden.clientSecret": "client_secret della chiave API",
  "connector.bitwarden.masterPassword": "Password principale",
  "connector.bitwarden.connecting": "Connessione",
  "connector.telegramAccount.title": "Account Telegram",
  "connector.telegramAccount.description":
    "Gli agenti possono leggere le tue chat di Telegram e, se lo consenti, inviare messaggi a tuo nome.",
  "connector.telegramAccount.descriptionHost":
    "Gli agenti su {host} possono leggere le tue chat di Telegram e, se lo consenti, inviare messaggi a tuo nome.",
  "connector.telegramAccount.statusConnecting": "Accesso",
  "connector.telegramAccount.statusConnected": "Connesso",
  "connector.telegramAccount.actionFailed": "OpenBot non è riuscito a modificare la connessione dell’account Telegram.",
  "connector.telegramAccount.disconnectTitle": "Disconnetti l’account Telegram",
  "connector.telegramAccount.disconnectSummary":
    "OpenBot esce da questa sessione. Gli agenti non possono più leggere né inviare messaggi e l’invio viene disattivato.",
  "connector.telegramAccount.disconnectSummaryHost":
    "{host} esce da questa sessione. Gli agenti su {host} non possono più leggere né inviare messaggi e l’invio viene disattivato.",
  "connector.telegramAccount.disconnect": "Disconnetti",
  "connector.telegramAccount.signInTitle": "Accedi",
  "connector.telegramAccount.howItWorks":
    "OpenBot accede al tuo account Telegram, come fa Telegram Desktop. La sessione resta cifrata su questo computer. Telegram la mostra in Impostazioni › Dispositivi come OpenBot.",
  "connector.telegramAccount.howItWorksHost":
    "{host} accede al tuo account Telegram, come fa Telegram Desktop. La sessione resta cifrata su {host}. Telegram la mostra in Impostazioni › Dispositivi come OpenBot.",
  "connector.telegramAccount.signInProgress":
    "Completa il passaggio qui sotto per accedere. Annulla interrompe l’accesso.",
  "connector.telegramAccount.methodTitle": "Accedi con",
  "connector.telegramAccount.methodQrDescription": "Scansiona un codice con Telegram sul telefono.",
  "connector.telegramAccount.methodPhoneDescription":
    "Inserisci il numero di telefono e il codice che Telegram ti invia.",
  "connector.telegramAccount.methodQr": "Codice QR",
  "connector.telegramAccount.methodPhone": "Telefono",
  "connector.telegramAccount.credentialsTitle": "api_id e api_hash",
  "connector.telegramAccount.credentialsStored":
    "OpenBot usa la tua app Telegram di my.telegram.org. Dopo il primo accesso, questo computer conserva api_id e api_hash.",
  "connector.telegramAccount.credentialsStoredHost":
    "OpenBot usa la tua app Telegram di my.telegram.org. Dopo il primo accesso, {host} conserva api_id e api_hash.",
  "connector.telegramAccount.credentialsOpen": "Inserisci",
  "connector.telegramAccount.credentialsHelp":
    "Accedi a my.telegram.org, apri API development tools e crea un’app. Copia qui api_id e api_hash.",
  "connector.telegramAccount.apiId": "api_id",
  "connector.telegramAccount.apiHash": "api_hash",
  "connector.telegramAccount.openApps": "Apri my.telegram.org",
  "connector.telegramAccount.openAppsFailed": "OpenBot non è riuscito ad aprire my.telegram.org.",
  "connector.telegramAccount.connect": "Connetti",
  "connector.telegramAccount.sendingOffNote": "Gli agenti possono solo leggere le tue chat finché non attivi l’invio.",
  "connector.telegramAccount.devicesNote":
    "Telegram mostra questa sessione in Impostazioni › Dispositivi come OpenBot. Se la chiudi lì, OpenBot si disconnette.",
  "connector.telegramAccount.devicesNoteHost":
    "Telegram mostra questa sessione in Impostazioni › Dispositivi come OpenBot. Se la chiudi lì, {host} si disconnette.",
  "connector.telegramAccount.connecting": "Connessione a Telegram",
  "connector.telegramAccount.connectingDescription":
    "Questo computer comunica con Telegram. Può richiedere qualche secondo.",
  "connector.telegramAccount.connectingHost": "{host} comunica con Telegram. Può richiedere qualche secondo.",
  "connector.telegramAccount.qrLabel": "Codice QR per accedere a Telegram",
  "connector.telegramAccount.qrTitle": "Scansiona questo codice con Telegram sul telefono",
  "connector.telegramAccount.qrStepOpen": "Apri Telegram sul telefono.",
  "connector.telegramAccount.qrStepDevices": "Vai in Impostazioni › Dispositivi › Collega dispositivo desktop.",
  "connector.telegramAccount.qrStepScan": "Inquadra questo codice con il telefono.",
  "connector.telegramAccount.qrRefresh": "Il codice cambia circa ogni 30 secondi. Scansiona quello più recente.",
  "connector.telegramAccount.usePhone": "Usa il telefono",
  "connector.telegramAccount.phoneDescription":
    "Inserisci il numero di telefono del tuo account Telegram, con il prefisso internazionale.",
  "connector.telegramAccount.phoneLabel": "Numero di telefono",
  "connector.telegramAccount.sendCode": "Invia codice",
  "connector.telegramAccount.phonePlaceholder": "+48 600 100 200",
  "connector.telegramAccount.useQr": "Usa il codice QR",
  "connector.telegramAccount.codeViaApp":
    "Telegram ha inviato un codice all’app Telegram sugli altri tuoi dispositivi.",
  "connector.telegramAccount.codeViaSms": "Telegram ha inviato un codice via SMS.",
  "connector.telegramAccount.codeDescription": "Inserisci il codice che Telegram ti ha inviato.",
  "connector.telegramAccount.codeLabel": "Codice",
  "connector.telegramAccount.signIn": "Accedi",
  "connector.telegramAccount.passwordDescription":
    "Il tuo account ha la verifica in due passaggi. Inserisci la password.",
  "connector.telegramAccount.passwordHint": "Suggerimento: {hint}",
  "connector.telegramAccount.passwordLabel": "Password della verifica in due passaggi",
  "connector.telegramAccount.accountTitle": "Account",
  "connector.telegramAccount.accountDescription": "Gli agenti su questo computer usano questo account Telegram.",
  "connector.telegramAccount.accountDescriptionHost": "Gli agenti su {host} usano questo account Telegram.",
  "connector.telegramAccount.sendingLabel": "Consenti agli agenti di inviare messaggi e segnare le chat come lette",
  "connector.telegramAccount.sendingDescription": "Se è disattivato, gli agenti possono solo leggere le tue chat.",
  "connector.whatsappAccount.title": "Account WhatsApp",
  "connector.whatsappAccount.developer": "WhatsApp",
  "connector.whatsappAccount.description":
    "Gli agenti possono leggere le tue chat di WhatsApp e, se lo consenti, inviare messaggi a tuo nome.",
  "connector.whatsappAccount.descriptionHost":
    "Gli agenti su {host} possono leggere le tue chat di WhatsApp e, se lo consenti, inviare messaggi a tuo nome.",
  "connector.whatsappAccount.statusConnecting": "Collegamento",
  "connector.whatsappAccount.statusConnected": "Connesso",
  "connector.whatsappAccount.actionFailed": "OpenBot non è riuscito a modificare la connessione dell’account WhatsApp.",
  "connector.whatsappAccount.disconnectTitle": "Scollega l’account WhatsApp",
  "connector.whatsappAccount.disconnectSummary":
    "OpenBot disconnette questo dispositivo collegato ed elimina le sue chiavi e le sue chat da questo computer. L’invio viene disattivato.",
  "connector.whatsappAccount.disconnectSummaryHost":
    "{host} disconnette questo dispositivo collegato ed elimina le sue chiavi e le sue chat. L’invio viene disattivato.",
  "connector.whatsappAccount.disconnect": "Scollega",
  "connector.whatsappAccount.linkTitle": "Collega",
  "connector.whatsappAccount.howItWorks":
    "OpenBot diventa un dispositivo collegato del tuo account WhatsApp, come fa WhatsApp Web. Il telefono resta il dispositivo principale. Le chiavi e le chat restano cifrate su questo computer.",
  "connector.whatsappAccount.howItWorksHost":
    "{host} diventa un dispositivo collegato del tuo account WhatsApp, come fa WhatsApp Web. Il telefono resta il dispositivo principale. Le chiavi e le chat restano cifrate su {host}.",
  "connector.whatsappAccount.riskNote":
    "WhatsApp non offre un accesso ufficiale per gli account personali. OpenBot usa un client WhatsApp Web non ufficiale e WhatsApp può limitare o bloccare i numeri che ritiene automatizzati. Invia solo ciò che invieresti tu.",
  "connector.whatsappAccount.linkProgress":
    "Completa il passaggio qui sotto per collegare. Annulla interrompe il collegamento.",
  "connector.whatsappAccount.methodTitle": "Collega con",
  "connector.whatsappAccount.methodQrDescription": "Scansiona un codice con WhatsApp sul telefono.",
  "connector.whatsappAccount.methodPhoneDescription": "Inserisci un codice sul telefono invece di scansionare.",
  "connector.whatsappAccount.methodQr": "Codice QR",
  "connector.whatsappAccount.methodPhone": "Telefono",
  "connector.whatsappAccount.connect": "Collega",
  "connector.whatsappAccount.sendingOffNote": "Gli agenti possono solo leggere le tue chat finché non attivi l’invio.",
  "connector.whatsappAccount.connecting": "Connessione a WhatsApp",
  "connector.whatsappAccount.connectingDescription":
    "Questo computer comunica con WhatsApp. Può richiedere qualche secondo.",
  "connector.whatsappAccount.connectingHost": "{host} comunica con WhatsApp. Può richiedere qualche secondo.",
  "connector.whatsappAccount.qrLabel": "Codice QR per collegare WhatsApp",
  "connector.whatsappAccount.qrTitle": "Scansiona questo codice con WhatsApp sul telefono",
  "connector.whatsappAccount.stepOpen": "Apri WhatsApp sul telefono.",
  "connector.whatsappAccount.stepDevices": "Vai in Impostazioni › Dispositivi collegati › Collega un dispositivo.",
  "connector.whatsappAccount.qrStepScan": "Inquadra questo codice con il telefono.",
  "connector.whatsappAccount.qrRefresh": "Il codice cambia circa ogni 20 secondi. Scansiona quello più recente.",
  "connector.whatsappAccount.usePhone": "Usa il telefono",
  "connector.whatsappAccount.useQr": "Usa il codice QR",
  "connector.whatsappAccount.phoneDescription":
    "Inserisci il numero di telefono del tuo account WhatsApp, con il prefisso internazionale. WhatsApp ti darà poi un codice da inserire sul telefono.",
  "connector.whatsappAccount.phoneLabel": "Numero di telefono",
  "connector.whatsappAccount.phonePlaceholder": "+48 600 100 200",
  "connector.whatsappAccount.getCode": "Ottieni codice",
  "connector.whatsappAccount.codeTitle": "Inserisci questo codice sul telefono",
  "connector.whatsappAccount.codeStepPhone": "Tocca Collega con il numero di telefono.",
  "connector.whatsappAccount.codeStepType": "Inserisci questo codice.",
  "connector.whatsappAccount.codeLabel": "Codice da inserire sul telefono",
  "connector.whatsappAccount.accountTitle": "Account",
  "connector.whatsappAccount.accountDescription": "Gli agenti su questo computer usano questo account WhatsApp.",
  "connector.whatsappAccount.accountDescriptionHost": "Gli agenti su {host} usano questo account WhatsApp.",
  "connector.whatsappAccount.historyChats": { one: "{count} chat", other: "{count} chat" },
  "connector.whatsappAccount.historyMessages": { one: "{count} messaggio", other: "{count} messaggi" },
  "connector.whatsappAccount.historyNote":
    "WhatsApp invia la cronologia recente quando il dispositivo si collega, poi ogni nuovo messaggio. I messaggi più vecchi possono mancare.",
  "connector.whatsappAccount.sendingLabel": "Consenti agli agenti di inviare messaggi e segnare le chat come lette",
  "connector.whatsappAccount.sendingDescription": "Se è disattivato, gli agenti possono solo leggere le tue chat.",
  "connector.whatsappAccount.devicesNote":
    "WhatsApp mostra OpenBot in Impostazioni › Dispositivi collegati. Se lo disconnetti lì, OpenBot si disconnette.",
  "connector.whatsappAccount.devicesNoteHost":
    "WhatsApp mostra OpenBot in Impostazioni › Dispositivi collegati. Se lo disconnetti lì, {host} si disconnette.",
} as const satisfies PartialTranslation<typeof source>;
