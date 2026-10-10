import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Programmazione",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Dati e analisi",
  "marketplace.category.documents": "Documenti",
  "marketplace.category.productivity": "Produttività",
  "marketplace.category.research": "Ricerca",
  "marketplace.category.automation": "Automazione",
  "marketplace.category.other": "Altro",
  "marketplace.loadFailed": "Impossibile caricare il Marketplace.",
  "marketplace.loading.skills": "Caricamento delle skill",
  "marketplace.loading.agents": "Caricamento degli agenti",
  "marketplace.noMatch.skills": "Nessuna skill corrisponde a questa ricerca.",
  "marketplace.noMatch.agents": "Nessun agente corrisponde a questa ricerca.",
  "marketplace.loadMore": "Carica altro",
  "marketplace.version": "Versione {version}",

  "marketplace.title": "Marketplace",
  "marketplace.close": "Chiudi il Marketplace",
  "marketplace.kinds": "Tipi di contenuto del Marketplace",
  "marketplace.tab.agents": "Agenti",
  "marketplace.tab.skills": "Skill",

  "marketplace.plugins.missing": "Questo plugin non è nel catalogo di OpenBot.",

  "marketplace.agents.loadingDetail": "Caricamento dei dettagli dell'agente…",
  "marketplace.agents.skills": "Skill",
  "marketplace.agents.routines": "Routine",
  "marketplace.agents.routineActive": "Attiva",
  "marketplace.agents.routineInactive": "Non attiva",

  "marketplace.skill.loading": "Caricamento della skill",
  "marketplace.skill.update": "Aggiorna skill",
  "marketplace.try.readFailed": "OpenBot non è riuscito a leggere le skill di questo agente. Riprova.",
  "marketplace.try.enable": "Attiva questa skill nelle impostazioni dell'agente per provarla.",
  "marketplace.try.repair": "Ripara questa skill nelle impostazioni dell'agente per provarla.",
  "marketplace.try.update": "Aggiorna questa skill per provare questa versione.",
  "marketplace.try.composerUnavailable": "Il campo di scrittura dell'agente non è disponibile.",

  "marketplace.open": "Apri {name}",
  "marketplace.tab.apps": "App",
  "marketplace.crumbs.label": "Posizione",
  "marketplace.search.label": "Cerca nel Marketplace",
  "marketplace.search.placeholder": "Cerca",
  "marketplace.installs": { one: "{installs} installazione", other: "{installs} installazioni" },
  "marketplace.filter": "Filtra",
  "marketplace.filter.on": "Filtro: {filters}",
  "marketplace.filter.all": "Tutti",
  "marketplace.filter.status": "Stato",
  "marketplace.filter.category": "Categoria",
  "marketplace.filter.added": "Aggiunti",
  "marketplace.filter.notAdded": "Non aggiunti",
  "marketplace.filter.installed": "Installati",
  "marketplace.filter.notInstalled": "Non installati",
  "marketplace.filter.clear": "Rimuovi filtri",
  "marketplace.noMatch.apps": "Nessuna app corrisponde a questa ricerca.",
  "marketplace.noMatch.filters": "Nessun risultato per i filtri scelti.",
  "marketplace.noMatch.showAgents": { one: "Mostra {count} agente", other: "Mostra {count} agenti" },
  "marketplace.noMatch.showApps": { one: "Mostra {count} app", other: "Mostra {count} app" },
  "marketplace.noMatch.showSkills": { one: "Mostra {count} skill", other: "Mostra {count} skill" },
  "marketplace.empty.agents": "Non ci sono ancora agenti nel Marketplace.",
  "marketplace.empty.apps": "Non ci sono ancora app nel Marketplace.",
  "marketplace.empty.skills": "Non ci sono ancora skill nel Marketplace.",
  "marketplace.properties.agent": "Informazioni sull'agente",
  "marketplace.properties.skill": "Informazioni sulla skill",
  "marketplace.properties.creator": "Autore",
  "marketplace.properties.category": "Categoria",
  "marketplace.properties.version": "Versione",
  "marketplace.properties.updated": "Aggiornata",
  "marketplace.properties.installs": "Installazioni",

  "marketplace.agent.add": "Aggiungi",
  "marketplace.agent.addNamed": "Aggiungi {name}",
  "marketplace.agent.addAgent": "Aggiungi agente",
  "marketplace.agent.added": "Aggiunto",
  "marketplace.agent.updateAvailable": "Aggiornamento disponibile",
  "marketplace.agent.update": "Aggiorna",
  "marketplace.agent.openChat": "Apri chat",

  "marketplace.app.connect": "Connetti",
  "marketplace.app.reconnect": "Riconnetti",
  "marketplace.app.connectNamed": "Connetti {name}",
  "marketplace.app.reconnectNamed": "Riconnetti {name}",
  "marketplace.app.connected": "Connessa",
  "marketplace.app.attention": "Richiede attenzione",
  "marketplace.app.notConnected": "Non collegata",
  "marketplace.app.custom": "Server MCP",
  "marketplace.app.githubTagline": "Repository, issue e pull request",
  "marketplace.app.onePasswordTagline": "Accedi ai siti con le credenziali che condividi",
  "marketplace.app.onePasswordCategory": "Gestione di accessi e credenziali",
  "marketplace.app.yourApps": "Le tue app",
  "marketplace.app.moreApps": "Altre app",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Comando",
  "marketplace.app.address": "Indirizzo",
  "marketplace.app.disconnect.title": "Disconnetti",
  "marketplace.app.disconnect.description":
    "Rimuovi {name} e le sue skill da questo computer. Potrai collegarla di nuovo più tardi.",
  "marketplace.app.disconnect.action": "Disconnetti",
  "marketplace.app.remove.title": "Rimuovi server",
  "marketplace.app.remove.description":
    "I tuoi agenti non potranno più usare questo server. Le sue impostazioni vengono eliminate.",
  "marketplace.app.remove.action": "Rimuovi",
  "marketplace.app.remove.confirmTitle": "Rimuovere {name}?",
  "marketplace.app.remove.keep": "Mantieni",

  "marketplace.plugin.aave.tagline": "Dati e transazioni di Aave",
  "marketplace.plugin.aave.description":
    "Aave aiuta a esplorare i mercati Aave V3 e V4 in tempo reale, controllare le posizioni dei wallet e la governance della DAO, simulare operazioni di prestito e preparare transazioni non custodial. Ogni transazione viene restituita non firmata: il plugin legge i mercati e scrive la chiamata, mentre il wallet resta all'utente.",
  "marketplace.plugin.aave.app":
    "Mercati V3 e V4 in tempo reale, posizioni dei wallet, governance della DAO e transazioni preparate, tramite un solo server MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield":
    "Dove posso guadagnare di più con le stablecoin su Aave in questo momento?",
  "marketplace.plugin.aave.prompt.usdcRates": "Cosa rende di più per USDC adesso, Aave V3 o V4 su Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Qual è l'health factor di 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c e quanto è lontano dalla liquidazione?",
  "marketplace.plugin.canva.tagline": "Design, risorse ed esportazioni",
  "marketplace.plugin.canva.description":
    "Canva permette di creare e modificare design a parole, cercare nella propria libreria, caricare e organizzare risorse, esportare nel formato che serve a un canale e lasciare commenti dove si lavora. Ogni utente accede al proprio account Canva e l'agente può fare ciò che può fare quell'account.",
  "marketplace.plugin.canva.app":
    "Creazione e modifica di design, ricerca nella libreria, gestione di risorse e brand, esportazioni e commenti, tramite un solo server MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Mostrami il design Canva che ho modificato più di recente.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Ridimensiona il mio poster di lancio per Instagram ed esporta entrambi in PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Trasforma queste note di rilascio in una presentazione Canva di sei slide.",
  "marketplace.plugin.linear.tagline": "Issue e triage dei progetti",
  "marketplace.plugin.linear.description":
    "Linear permette agli agenti di elencare le issue assegnate, fare il triage del backlog, aggiornare gli stati e preparare nuove issue nello spazio di lavoro a cui appartiene l'account collegato. Ogni utente accede al proprio account Linear dal browser.",
  "marketplace.plugin.linear.app":
    "Ricerca di issue, triage, aggiornamento degli stati e creazione di issue, tramite il server MCP di Linear con accesso dal browser.",
  "marketplace.plugin.linear.prompt.myWeek": "Cosa mi è stato assegnato questa settimana?",
  "marketplace.plugin.linear.prompt.backlog":
    "Fai il triage del backlog: cosa è fermo da tempo, bloccato o senza responsabile?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Apri una issue per il crash nella coda di sincronizzazione, con i passaggi per riprodurlo.",
  "marketplace.plugin.notion.tagline": "Documenti e knowledge base",
  "marketplace.plugin.notion.description":
    "Notion permette agli agenti di leggere e scrivere pagine, cercare nello spazio di lavoro e tenere note di riunione e specifiche dove il team già lavora. Ogni utente accede al proprio account Notion dal browser.",
  "marketplace.plugin.notion.app":
    "Ricerca, lettura e scrittura di pagine e navigazione nello spazio di lavoro, tramite il server MCP di Notion con accesso dal browser.",
  "marketplace.plugin.notion.prompt.findSpec": "Trova le specifiche di lancio attuali e riassumi le questioni aperte.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Trasforma questi punti in una nota di riunione strutturata nello spazio del mio team.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Aggiorna il documento di onboarding con la nuova checklist di rilascio.",
  "marketplace.plugin.figma.tagline": "Design e prototipi",
  "marketplace.plugin.figma.description":
    "Figma permette agli agenti di leggere i file di design, ispezionare componenti, stili e variabili e passare le specifiche di produzione agli sviluppatori. Si collega al server MCP dell'app desktop di Figma, su questo computer. Il server può solo leggere i design; il supporto alla scrittura è in sviluppo.",
  "marketplace.plugin.figma.app":
    "Contesto di design, metadati, variabili e screenshot, tramite il server MCP dell'app desktop di Figma. Per ora in sola lettura.",
  "marketplace.plugin.figma.prompt.handoff":
    "Prepara la consegna del file checkout: elenca schermate, componenti e stili.",
  "marketplace.plugin.figma.prompt.audit": "Controlla questo file per trovare incoerenze di spaziatura e colori.",
  "marketplace.plugin.figma.prompt.assets": "Estrai le icone di marketing a 2x per il bundle dell'app.",
  "marketplace.plugin.paper.tagline": "Tela di design basata su HTML e CSS",
  "marketplace.plugin.paper.description":
    "Paper permette agli agenti di leggere e scrivere il file di design aperto in Paper Desktop: ispezionare artboard, selezioni, stili calcolati, JSX e token, e creare o modificare frame, testi e stili. Installa Paper Desktop, aprilo una volta e apri un file prima di iniziare. OpenBot avvia la CLI di Paper che Paper Desktop installa. Paper non richiede chiavi. Gli strumenti di scrittura modificano il file aperto, quindi controlla ogni scrittura prima di approvarla.",
  "marketplace.plugin.paper.app":
    "Legge e scrive il file aperto in Paper Desktop, tramite il server MCP locale che la CLI di Paper inoltra. Richiede Paper Desktop con un file aperto.",
  "marketplace.plugin.paper.prompt.implement":
    "Implementa il frame Paper selezionato in questo codice, seguendo le nostre convenzioni.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Usa gli stili di questo repository e progetta una pagina delle impostazioni in Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Elenca i design token del file Paper aperto e confrontali con il nostro tema.",
  "marketplace.plugin.sentry.tagline": "Errori e triage dei crash",
  "marketplace.plugin.sentry.description":
    "Sentry permette agli agenti di cercare gli errori recenti, ispezionare stack trace e versioni coinvolte e riassumere cosa si è rotto dopo un deploy. Ogni utente accede al proprio account Sentry dal browser.",
  "marketplace.plugin.sentry.app":
    "Ricerca di errori, ispezione delle issue e salute delle versioni, tramite il server MCP di Sentry con accesso dal browser.",
  "marketplace.plugin.sentry.prompt.newErrors": "Quali nuovi errori sono comparsi dal deploy di ieri?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Spiega il crash principale del progetto mobile e la sua causa probabile.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Quanto è stabile la versione attuale rispetto alla precedente?",
  "marketplace.plugin.context7.tagline": "Documentazione aggiornata delle librerie",
  "marketplace.plugin.context7.description":
    "Context7 recupera la documentazione e i riferimenti API aggiornati di librerie e framework, così le risposte usano la versione che il progetto usa davvero. Non servono né un account né una chiave.",
  "marketplace.plugin.context7.app":
    "Ricerca nella documentazione aggiornata delle librerie, tramite il server MCP di Context7 senza accesso.",
  "marketplace.plugin.context7.prompt.apiCheck": "Qual è l'API attuale per le liste virtualizzate in questo framework?",
  "marketplace.plugin.context7.prompt.migrate": "Cosa è cambiato tra la v2 e la v3 di questo router?",
  "marketplace.plugin.context7.prompt.example": "Mostrami un esempio aggiornato di upload di file autenticato.",
  "marketplace.plugin.stripe.tagline": "Pagamenti e controllo della fatturazione",
  "marketplace.plugin.stripe.description":
    "Stripe permette agli agenti di cercare pagamenti, clienti e fatture e di preparare link di pagamento, nell'account a cui l'utente collegato ha accesso. Ogni utente accede al proprio account Stripe dal browser.",
  "marketplace.plugin.stripe.app":
    "Ricerca di pagamenti, clienti e fatture, tramite il server MCP di Stripe con accesso dal browser.",
  "marketplace.plugin.stripe.prompt.payment": "Cerca questo pagamento e spiega perché è fallito.",
  "marketplace.plugin.stripe.prompt.customer": "Riassumi le fatture di questo cliente e il saldo da pagare.",
  "marketplace.plugin.stripe.prompt.link": "Prepara un link di pagamento per il piano Pro a 49 al mese.",
  "marketplace.plugin.posthog.tagline": "Analisi di prodotto e flag",
  "marketplace.plugin.posthog.description":
    "PostHog permette agli agenti di interrogare eventi e funnel, ispezionare i feature flag e riassumere cosa è cambiato dopo un rilascio. Una chiave API personale, presa dalle impostazioni del progetto, va in un unico header Authorization.",
  "marketplace.plugin.posthog.app":
    "Accesso a eventi, funnel e feature flag, tramite il server MCP di PostHog con una chiave API personale.",
  "marketplace.plugin.posthog.prompt.funnel": "Com'è andato il funnel di iscrizione negli ultimi 14 giorni?",
  "marketplace.plugin.posthog.prompt.flag": "Quali feature flag sono attivi per questo utente?",
  "marketplace.plugin.posthog.prompt.release": "L'attivazione è cambiata dopo il rilascio della settimana scorsa?",
  "marketplace.plugin.airtable.tagline": "Base e record",
  "marketplace.plugin.airtable.description":
    "Airtable permette agli agenti di elencare le base, leggere e aggiornare i record e riassumere il contenuto delle tabelle. Una chiave API presa dalla pagina dell'account viene passata al server locale come variabile d'ambiente.",
  "marketplace.plugin.airtable.app":
    "Elenco delle base e accesso ai record, tramite un server MCP locale con una chiave API di Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "A quali base ho accesso?",
  "marketplace.plugin.airtable.prompt.records": "Riassumi la tabella del tracker di lancio.",
  "marketplace.plugin.airtable.prompt.update": "Segna come completate le funzioni rilasciate nella base della roadmap.",
  "marketplace.plugin.firecrawl.tagline": "Estrazione dal web e ricerca",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl permette agli agenti di fare scraping di pagine, estrarre dati strutturati e cercare sul web con una sola API. Una chiave API presa dalla dashboard di Firecrawl viene passata al server locale come variabile d'ambiente.",
  "marketplace.plugin.firecrawl.app":
    "Scraping di pagine, estrazione e ricerca sul web, tramite un server MCP locale con una chiave API di Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Estrai la tabella dei prezzi da questa pagina come dati strutturati.",
  "marketplace.plugin.firecrawl.prompt.research":
    "Fai una ricerca sui prezzi dei concorrenti e cita ogni pagina fonte.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Cosa è cambiato questo mese nella nostra pagina del changelog?",
  "marketplace.plugin.braveSearch.tagline": "Ricerca web privata",
  "marketplace.plugin.braveSearch.description":
    "Brave Search permette agli agenti di cercare sul web e risultati locali senza tracciamento. Una chiave API presa dalla dashboard di Brave Search API viene passata al server locale come variabile d'ambiente.",
  "marketplace.plugin.braveSearch.app":
    "Ricerca web e locale, tramite un server MCP locale con una chiave API di Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Cosa dicono i recensori di questa versione del framework?",
  "marketplace.plugin.braveSearch.prompt.news": "Trova gli annunci di oggi per quest'area di prodotto.",
  "marketplace.plugin.braveSearch.prompt.compare": "Confronta questi due fornitori citando le fonti.",
  "marketplace.plugin.resend.tagline": "Email transazionali",
  "marketplace.plugin.resend.description":
    "Resend permette agli agenti di inviare email transazionali e controllarne la consegna con una sola API. Una chiave API presa dalla dashboard di Resend viene passata al server locale come variabile d'ambiente.",
  "marketplace.plugin.resend.app":
    "Invio di email e controllo della consegna, tramite un server MCP locale con una chiave API di Resend.",
  "marketplace.plugin.resend.prompt.send": "Invia la bozza dell'annuncio di lancio alla lista beta.",
  "marketplace.plugin.resend.prompt.status": "L'email della fattura è arrivata al cliente?",
  "marketplace.plugin.resend.prompt.template":
    "Prepara una bozza di email per reimpostare la password nel nuovo flusso.",
  "marketplace.plugin.composio.tagline": "Tante app tramite il tuo link Composio",
  "marketplace.plugin.composio.description":
    "Composio collega gli agenti a Gmail, Slack, GitHub e centinaia di altre app tramite un solo server MCP. Crea il server nel tuo account Composio, aggiungi le app che vuoi e incolla qui il suo link. Aggiungi una chiave API solo se il tuo server la richiede.",
  "marketplace.plugin.composio.app":
    "Le app che aggiungi al tuo server MCP Composio, tramite il link del tuo account Composio.",
  "marketplace.plugin.composio.prompt.inbox": "Riassumi le mie email non lette e prepara le risposte a quelle urgenti.",
  "marketplace.plugin.composio.prompt.handoff":
    "Pubblica nel canale del nostro team un riassunto di questa pull request.",
  "marketplace.plugin.composio.prompt.apps": "Quali app e azioni puoi usare tramite Composio?",

  "marketplace.skill.installMenu.install": "Installa",
  "marketplace.skill.installMenu.installNamed": "Installa {name}",
  "marketplace.skill.installMenu.allAgents": "Tutti gli agenti",
  "marketplace.skill.installMenu.agents": { one: "{count} agente", other: "{count} agenti" },
  "marketplace.skill.installMenu.here": "Sei qui",
  "marketplace.skill.installMenu.change": {
    one: "{label} ha {name}. Cambia",
    other: "{label} hanno {name}. Cambia",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Prova in {name}",

  "marketplace.notice.agentAdded": "{name} aggiunto.",
  "marketplace.notice.agentUpdated": "{name} aggiornato.",
  "marketplace.notice.appConnected": "{name} collegata.",
  "marketplace.notice.appDisconnected": "{name} scollegata.",
  "marketplace.notice.serverRemoved": "{name} rimosso.",
  "marketplace.notice.skillInstalled": {
    one: "{name} installata su {count} agente.",
    other: "{name} installata su {count} agenti.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} rimossa da {count} agente.",
    other: "{name} rimossa da {count} agenti.",
  },
  "marketplace.error.skillPartial": "{name} non è cambiata su questi agenti: {agents}. {reason}",

  "marketplace.error.openLink": "Impossibile aprire il link.",
  "marketplace.error.copyLink": "Impossibile copiare il link.",
  "marketplace.error.connectNoServer": "Seleziona un server locale per collegare questa app.",
  "marketplace.error.installNoServer": "Seleziona un server locale per installare un plugin.",
  "marketplace.error.installNoAgent": "Scegli un agente su cui installare le skill di questo plugin.",
  "marketplace.error.installLocalOnHost":
    "Installa {name} sul computer che esegue questi agenti: la sua app esegue il proprio server su quel computer.",
  "marketplace.error.installOnHost":
    "Installa {name} sul computer che esegue questi agenti: la sua app richiede un accesso dal browser.",
  "marketplace.error.appInvalid": "Impossibile aggiungere {name}: {reason}",
  "marketplace.error.uninstallNoServer": "Seleziona un server locale per disinstallare un plugin.",
  "marketplace.error.uninstallPartial": "Non è stato possibile rimuovere alcune parti di {name}. {failures}",
  "marketplace.error.actionFailed": "Impossibile completare l'azione del Marketplace. Riprova.",
  "marketplace.thisAgent": "questo agente",
} as const satisfies PartialTranslation<typeof source>;
