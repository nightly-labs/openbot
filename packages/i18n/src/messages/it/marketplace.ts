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
  "marketplace.loading.skills": "Caricamento skill",
  "marketplace.loading.agents": "Caricamento agenti",
  "marketplace.noMatch.skills": "Nessuna skill corrisponde a questa ricerca.",
  "marketplace.noMatch.agents": "Nessun agente corrisponde a questa ricerca.",
  "marketplace.loadMore": "Carica altro",
  "marketplace.version": "Versione {version}",

  "marketplace.title": "Marketplace",
  "marketplace.kinds": "Tipi di contenuto del Marketplace",
  "marketplace.tab.agents": "Agenti",
  "marketplace.tab.skills": "Skill",
  "marketplace.description.apps": "Collega gli strumenti e i servizi con cui lavorano i tuoi agenti.",
  "marketplace.description.agents": "Agenti pronti all’uso, con istruzioni e skill proprie.",
  "marketplace.description.skills": "Istruzioni che insegnano a un agente un compito o uno strumento.",

  "marketplace.plugins.missing": "Questo plugin non è nel catalogo di OpenBot.",

  "marketplace.agents.loadingDetail": "Caricamento dettagli agente…",
  "marketplace.agents.skills": "Skill",
  "marketplace.agents.routines": "Routine",
  "marketplace.agents.routineActive": "Attiva",
  "marketplace.agents.routineInactive": "Non attiva",

  "marketplace.skill.loading": "Caricamento skill",
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
  "marketplace.properties.creator": "Autore",
  "marketplace.properties.category": "Categoria",
  "marketplace.properties.version": "Versione",
  "marketplace.properties.updated": "Ultimo aggiornamento",
  "marketplace.properties.installs": "Installazioni",

  "marketplace.agent.add": "Aggiungi",
  "marketplace.agent.addNamed": "Aggiungi {name}",
  "marketplace.agent.addAgent": "Aggiungi agente",
  "marketplace.agent.added": "Aggiunto",
  "marketplace.agent.updateAvailable": "Aggiornabile",
  "marketplace.agent.update": "Aggiorna",
  "marketplace.agent.openChat": "Apri chat",

  "marketplace.app.connect": "Connetti",
  "marketplace.app.reconnect": "Riconnetti",
  "marketplace.app.connectNamed": "Connetti {name}",
  "marketplace.app.reconnectNamed": "Riconnetti {name}",
  "marketplace.app.connected": "Connessa",
  "marketplace.app.attention": "Richiede attenzione",
  "marketplace.app.partialTitle": "{name} non è completo",
  "marketplace.app.partialDescription": "Alcune delle sue app o skill non sono installate. Riconnetti le installa.",
  "marketplace.app.notConnected": "Non connessa",
  "marketplace.app.custom": "Server MCP",
  "marketplace.app.githubTagline": "Repository, issue e pull request",
  "marketplace.app.onePasswordTagline": "Accedi ai siti con le credenziali che condividi",
  "marketplace.app.slackTagline": "Menzioni e messaggi diretti in Slack",
  "marketplace.app.discordTagline": "Menzioni e messaggi diretti in Discord",
  "marketplace.app.telegramTagline": "Gruppi e chat dirette in Telegram",
  "marketplace.app.bitwardenTagline": "Accedi ai siti con le credenziali di una cartella condivisa",
  "marketplace.app.onePasswordCategory": "Gestione di accessi e credenziali",
  "marketplace.app.yourApps": "Le tue app",
  "marketplace.app.addCustom": "Aggiungi personalizzata",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Comando",
  "marketplace.app.address": "Indirizzo",
  "marketplace.app.disconnect.title": "Disconnetti {name}",
  "marketplace.app.disconnect.description":
    "Rimuovi {name} e le sue skill da questo computer. Potrai connetterla di nuovo più tardi.",
  "marketplace.app.disconnect.action": "Disconnetti",
  "marketplace.app.remove.title": "Rimuovi server",
  "marketplace.app.remove.description":
    "I tuoi agenti non potranno più usare questo server. Le sue impostazioni vengono eliminate.",
  "marketplace.app.remove.action": "Rimuovi",
  "marketplace.app.remove.confirmTitle": "Rimuovere {name}?",
  "marketplace.app.remove.keep": "Mantieni",
  "marketplace.app.connection": "Connessione",
  "marketplace.app.setup.account": "Accedi con il tuo account {name} nel browser.",
  "marketplace.app.setup.key": "Richiede una chiave API del tuo account {name}.",
  "marketplace.app.setup.keySaved": "{field} si trova su {host}.",
  "marketplace.app.setup.desktop": "Funziona nell'app desktop di {name} all'indirizzo {address}.",
  "marketplace.app.setup.desktopConnected": "Connessa a {address}.",
  "marketplace.app.setup.open": "Non servono accesso né chiave.",
  "marketplace.app.connectAgain": "Connetti di nuovo",
  "marketplace.app.automation.askOnInstall": "Chiedi accesso a macOS all'installazione",
  "marketplace.app.automation.title": "Accesso alle app Apple",
  "marketplace.app.automation.description":
    "macOS mostra una richiesta per ogni app. Un'app chiusa si apre per un momento, poi si chiude.",
  "marketplace.app.automation.request": "Chiedi accesso",
  "marketplace.app.automation.allowed": "Ora OpenBot può controllare tutte le app Apple.",
  "marketplace.app.automation.refused":
    "macOS non ha dato accesso a {apps}. Consenti OpenBot in Impostazioni di Sistema › Privacy e sicurezza › Automazione.",
  "marketplace.app.automation.failed": "OpenBot non è riuscito a chiedere a macOS per {apps}. Riprova.",
  "marketplace.app.automation.app.calendar": "Calendario",
  "marketplace.app.automation.app.contacts": "Contatti",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Note",
  "marketplace.app.automation.app.reminders": "Promemoria",
  "marketplace.app.automation.app.messages": "Messaggi",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Accedi di nuovo a {name}",
  "marketplace.app.signInDescription":
    "{name} ha rifiutato l'accesso salvato. I tuoi agenti non possono usarla finché non accedi di nuovo.",

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
    "Linear permette agli agenti di elencare le issue assegnate, fare il triage del backlog, aggiornare gli stati e preparare nuove issue nel workspace a cui appartiene l'account collegato. Ogni utente accede al proprio account Linear dal browser.",
  "marketplace.plugin.linear.app":
    "Ricerca di issue, triage, aggiornamento degli stati e creazione di issue, tramite il server MCP di Linear con accesso dal browser.",
  "marketplace.plugin.linear.prompt.myWeek": "Cosa mi è stato assegnato questa settimana?",
  "marketplace.plugin.linear.prompt.backlog":
    "Fai il triage del backlog: cosa è fermo da tempo, bloccato o senza responsabile?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Apri una issue per il crash nella coda di sincronizzazione, con i passaggi per riprodurlo.",
  "marketplace.plugin.notion.tagline": "Documenti e knowledge base",
  "marketplace.plugin.notion.description":
    "Notion permette agli agenti di leggere e scrivere pagine, cercare nel workspace e tenere note di riunione e specifiche dove il team già lavora. Ogni utente accede al proprio account Notion dal browser.",
  "marketplace.plugin.notion.app":
    "Ricerca, lettura e scrittura di pagine e navigazione nel workspace, tramite il server MCP di Notion con accesso dal browser.",
  "marketplace.plugin.notion.prompt.findSpec": "Trova le specifiche di lancio attuali e riassumi le questioni aperte.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Trasforma questi punti in una nota di riunione strutturata nello spazio del mio team.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Aggiorna il documento di onboarding con la nuova checklist di rilascio.",
  "marketplace.plugin.cobrain.tagline": "Memoria condivisa per i tuoi agenti IA",
  "marketplace.plugin.cobrain.description":
    "Cobrain è una memoria in Markdown che ogni IA collegata può leggere e scrivere. Gli agenti caricano il contesto di un cliente o di un progetto prima di lavorare, cercano note e decisioni passate e salvano ciò che imparano, così la conversazione successiva riparte da dove si era fermata la precedente. Ogni utente accede al proprio account Cobrain.",
  "marketplace.plugin.cobrain.app":
    "Lettura, ricerca e scrittura di note nel tuo cervello Cobrain, tramite un server MCP.",
  "marketplace.plugin.cobrain.prompt.startSession":
    "Carica il mio contesto Cobrain per questo progetto prima di iniziare.",
  "marketplace.plugin.cobrain.prompt.searchDecision": "Cerca nelle mie note Cobrain cosa abbiamo deciso sui prezzi.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Salva una nota in Cobrain con quello che abbiamo fatto oggi e quello che resta.",
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
    "Paper permette agli agenti di leggere e scrivere il file di design aperto in Paper Desktop: ispezionare artboard, selezioni, stili calcolati, JSX e token, e creare o modificare frame, testi e stili. Installa Paper Desktop, aprilo una volta e apri un file prima di iniziare. OpenBot avvia la CLI di Paper che Paper Desktop installa. Paper non richiede chiavi. I tool di scrittura modificano il file aperto, quindi controlla ogni scrittura prima di approvarla.",
  "marketplace.plugin.paper.app":
    "Legge e scrive il file aperto in Paper Desktop, tramite il server MCP locale che la CLI di Paper inoltra. Richiede Paper Desktop con un file aperto.",
  "marketplace.plugin.paper.prompt.implement":
    "Implementa il frame Paper selezionato in questo codice, seguendo le nostre convenzioni.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Usa gli stili di questo repository e progetta una pagina delle impostazioni in Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Elenca i design token del file Paper aperto e confrontali con il nostro tema.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendario e altro sul tuo Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps consente agli agenti di usare Mail, Calendario, Contatti, Promemoria, Note, Messaggi e Safari su questo Mac. Funziona solo su macOS. OpenBot avvia mcp-icloud, un server della community che non è fatto da Apple né da OpenBot. Il server controlla le app tramite AppleScript, su questo computer, e non richiede account né chiavi. Durante l'installazione, OpenBot può chiedere a macOS l'accesso a tutte queste app in una volta, con una richiesta per app. Altrimenti macOS lo chiede la prima volta che un agente usa un'app. Per cambiarlo in seguito, apri Impostazioni di Sistema › Privacy e sicurezza › Automazione. Gli agenti possono inviare email e iMessage e modificare o eliminare eventi, contatti e promemoria, quindi controlla ogni scrittura prima di approvarla. Ciò che gli strumenti leggono, come il testo delle email, va al provider del modello dell'agente.",
  "marketplace.plugin.appleApps.app":
    "Mail, Calendario, Contatti, Promemoria, Note, Messaggi e Safari, tramite il server locale mcp-icloud. Richiede macOS e l'accesso in Automazione.",
  "marketplace.plugin.appleApps.prompt.unread": "Riassumi le mie email non lette di oggi in Apple Mail.",
  "marketplace.plugin.appleApps.prompt.today": "Cosa c'è nel mio Calendario Apple oggi e domani?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Trova l'email più recente sulla riunione del progetto e aggiungi la riunione al mio calendario.",
  "marketplace.plugin.sentry.tagline": "Errori e triage dei crash",
  "marketplace.plugin.sentry.description":
    "Sentry permette agli agenti di cercare gli errori recenti, ispezionare stack trace e versioni coinvolte e riassumere cosa si è rotto dopo un deploy. Ogni utente accede al proprio account Sentry dal browser.",
  "marketplace.plugin.sentry.app":
    "Ricerca di errori, ispezione delle issue e salute delle versioni, tramite il server MCP di Sentry con accesso dal browser.",
  "marketplace.plugin.sentry.prompt.newErrors": "Quali nuovi errori sono comparsi dal deploy di ieri?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Spiega il crash principale del progetto mobile e la sua causa probabile.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Quanto è stabile la versione attuale rispetto alla precedente?",
  "marketplace.plugin.vercel.tagline": "Deploy, log di build e progetti",
  "marketplace.plugin.vercel.description":
    "Vercel consente agli agenti di elencare i progetti e i deploy recenti, leggere i log di build e di runtime e capire perché una build non è riuscita. Ogni utente accede al proprio account Vercel dal browser e sceglie i team che gli agenti possono usare. In quei team gli agenti hanno gli stessi permessi dell'account dell'utente. Possono anche modificare variabili d'ambiente, domini, record DNS e deploy, e acquistare domini.",
  "marketplace.plugin.vercel.app":
    "Progetti, deploy, log di build e di runtime, tramite il server MCP di Vercel con accesso dal browser.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Perché l'ultimo deploy di produzione non è riuscito?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Elenca i deploy di oggi e il loro stato.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Quali route hanno avuto errori di runtime nell'ultima ora?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, storage e log",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare consente agli agenti di elencare e gestire Workers, record DNS, R2, D1 e KV tramite l'API di Cloudflare, interrogare i log dei Workers e cercare nella documentazione di Cloudflare. Ogni utente accede al proprio account Cloudflare dal browser. Nella pagina di consenso di Cloudflare, scegli Read only: con l'opzione predefinita, Minimal, gli agenti non vedono Workers, log né record DNS. Con i permessi di scrittura, gli agenti possono distribuire ed eliminare Workers, modificare i record DNS e cambiare altre impostazioni dell'account.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, storage e log, tramite il server MCP dell'API di Cloudflare con accesso dal browser.",
  "marketplace.plugin.cloudflare.prompt.workers": "Quali Workers sono distribuiti nel mio account Cloudflare?",
  "marketplace.plugin.cloudflare.prompt.errors": "Quali Workers di Cloudflare hanno registrato errori nell'ultima ora?",
  "marketplace.plugin.cloudflare.prompt.dns": "Elenca i record DNS di ogni zona del mio account Cloudflare.",
  "marketplace.plugin.supabase.tagline": "Database, log ed edge function",
  "marketplace.plugin.supabase.description":
    "Supabase consente agli agenti di elencare i progetti, eseguire SQL, leggere gli schemi delle tabelle e i log, controllare i suggerimenti di sicurezza e prestazioni degli advisor, gestire edge function e branch e cercare nella documentazione di Supabase. Ogni utente accede al proprio account Supabase dal browser e sceglie un'organizzazione. Gli agenti hanno accesso completo: possono eseguire SQL che modifica o elimina dati, applicare migrazioni, distribuire edge function e creare o mettere in pausa progetti.",
  "marketplace.plugin.supabase.app":
    "Database, log ed edge function, tramite il server MCP di Supabase con accesso dal browser.",
  "marketplace.plugin.supabase.prompt.projects": "Quali progetti ci sono nella mia organizzazione Supabase?",
  "marketplace.plugin.supabase.prompt.tables": "Elenca le tabelle e le colonne del mio database Supabase.",
  "marketplace.plugin.supabase.prompt.errors": "Quali errori ha registrato il mio progetto Supabase nell'ultima ora?",
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
    "Brave Search permette agli agenti di cercare sul web e tra i risultati locali senza tracciamento. Una chiave API presa dalla dashboard di Brave Search API viene passata al server locale come variabile d'ambiente.",
  "marketplace.plugin.braveSearch.app":
    "Ricerca web e locale, tramite un server MCP locale con una chiave API di Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Cosa dicono i recensori di questa versione del framework?",
  "marketplace.plugin.braveSearch.prompt.news": "Trova gli annunci di oggi per quest'area di prodotto.",
  "marketplace.plugin.braveSearch.prompt.compare": "Confronta questi due fornitori citando le fonti.",
  "marketplace.plugin.obsidian.tagline": "Note del tuo vault",
  "marketplace.plugin.obsidian.description":
    "Obsidian consente agli agenti di cercare, leggere e scrivere le note del tuo vault, che può così fare da loro memoria. Il server locale si collega al plugin Local REST API nell'app Obsidian su questo computer. La chiave API del plugin viene passata al server locale come variabile d'ambiente. Tieni Obsidian aperto mentre gli agenti lo usano.",
  "marketplace.plugin.obsidian.app":
    "Ricerca, lettura e modifica delle note, tramite un server MCP locale con la chiave del plugin Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Cosa dicono le mie note sulle decisioni di questo progetto?",
  "marketplace.plugin.obsidian.prompt.save": "Salva questa decisione come nuova nota nel mio vault.",
  "marketplace.plugin.obsidian.prompt.log":
    "Aggiungi un riepilogo del lavoro di oggi alla mia nota Registro di lavoro.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'In Obsidian, apri Settings > Local REST API. Copia la chiave API e attiva "Enable non-encrypted (HTTP) server".',
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
    "Composio collega gli agenti a Gmail, Slack, GitHub e centinaia di altre app tramite un solo server MCP. Collega le app che vuoi nel tuo account Composio, poi incolla qui il suo URL MCP e la sua chiave API.",
  "marketplace.plugin.composio.app":
    "Le app che aggiungi al tuo server MCP Composio, tramite il link del tuo account Composio.",
  "marketplace.plugin.composio.prompt.inbox": "Riassumi le mie email non lette e prepara le risposte a quelle urgenti.",
  "marketplace.plugin.composio.prompt.handoff":
    "Pubblica nel canale del nostro team un riassunto di questa pull request.",
  "marketplace.plugin.composio.prompt.apps": "Quali app e azioni puoi usare tramite Composio?",
  "marketplace.plugin.composio.hint.url": "L'URL di un server MCP nel tuo account Composio",
  "marketplace.plugin.composio.hint.apiKey": "La trovi nel tuo account Composio, in Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Progetti, branch e migrazioni Postgres",
  "marketplace.plugin.neon.description":
    "Neon consente agli agenti di elencare progetti e branch, eseguire SQL, leggere gli schemi delle tabelle, provare modifiche allo schema in un branch temporaneo, trovare le query lente e cercare nella documentazione di Neon. Ogni utente accede al proprio account Neon dal browser e può scegliere l'accesso in sola lettura durante l'autorizzazione. Con l'accesso completo, gli agenti possono eseguire SQL che modifica o elimina dati e creare, reimpostare o eliminare branch, database e progetti. Neon consiglia il suo server MCP per sviluppo e test, non per i database di produzione.",
  "marketplace.plugin.neon.app":
    "Progetti, branch, SQL e migrazioni Postgres, tramite il server MCP di Neon con accesso dal browser.",
  "marketplace.plugin.neon.prompt.projects": "Quali progetti e branch ci sono nel mio account Neon?",
  "marketplace.plugin.neon.prompt.slowQueries": "Quali query sono le più lente nel mio database Neon, e perché?",
  "marketplace.plugin.neon.prompt.migration":
    "Aggiungi un indice alla tabella orders in un branch temporaneo e mostrami il risultato prima di applicarlo.",
  "marketplace.plugin.prisma.tagline": "Database Postgres, backup e app Compute",
  "marketplace.plugin.prisma.description":
    "Prisma consente agli agenti di elencare e creare database Prisma Postgres, leggere gli schemi, eseguire SQL, elencare i backup e ripristinarli in un nuovo database, gestire i bucket di Object Storage, leggere build e log di Compute e cercare nella documentazione di Prisma. Ogni utente accede al proprio account Prisma dal browser e seleziona un workspace. Gli agenti hanno accesso completo: possono eseguire SQL che modifica o elimina dati, aggiornare gli schemi, eliminare database e bucket, e arrestare, riportare a una versione precedente o eliminare i deploy di Compute.",
  "marketplace.plugin.prisma.app":
    "Database, SQL, backup e app Compute, tramite il server MCP di Prisma con accesso dal browser.",
  "marketplace.plugin.prisma.prompt.databases": "Quali database ci sono nel mio workspace Prisma?",
  "marketplace.plugin.prisma.prompt.backups": "Mostrami tutti i backup disponibili del mio database.",
  "marketplace.plugin.prisma.prompt.logs": "Mostra i log di runtime del mio ultimo deploy di Compute.",
  "marketplace.plugin.netlify.tagline": "Progetti, deploy e log delle richieste",
  "marketplace.plugin.netlify.description":
    "Netlify consente agli agenti di elencare progetti e deploy, leggere i log delle richieste edge, creare progetti e distribuire codice in un progetto esistente. Ogni utente accede al proprio account Netlify dal browser. Gli agenti hanno lo stesso accesso dell'account dell'utente: possono modificare variabili d'ambiente, moduli e accesso dei visitatori, installare o rimuovere estensioni, ed eliminare invii dei moduli e variabili d'ambiente.",
  "marketplace.plugin.netlify.app":
    "Progetti, deploy, log delle richieste e impostazioni del sito, tramite il server MCP di Netlify con accesso dal browser.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "Qual è lo stato dell'ultimo deploy di ciascuno dei miei progetti Netlify?",
  "marketplace.plugin.netlify.prompt.errors":
    "Quali URL del mio sito hanno restituito errori del server nell'ultimo giorno?",
  "marketplace.plugin.netlify.prompt.deploy": "Fai il deploy di questa cartella nel mio progetto Netlify esistente.",
  "marketplace.plugin.railway.tagline": "Progetti, servizi e deploy",
  "marketplace.plugin.railway.description":
    "Railway consente agli agenti di elencare progetti e servizi, creare progetti, ripetere il deploy dei servizi e gestire i feature flag. Gli agenti possono anche affidare un lavoro in più passaggi al Railway Agent, che legge i log, capisce perché un deploy non è riuscito, crea servizi e imposta variabili. Ogni utente accede al proprio account Railway dal browser e sceglie gli spazi di lavoro e i progetti che gli agenti possono usare. In quei progetti gli agenti hanno accesso completo: possono pubblicare le modifiche in attesa, eliminare feature flag e modificare servizi, variabili, database e rete tramite il Railway Agent.",
  "marketplace.plugin.railway.app":
    "Progetti, servizi e deploy, tramite il server MCP di Railway con accesso dal browser.",
  "marketplace.plugin.railway.prompt.projects": "Quali progetti e servizi ci sono nel mio spazio di lavoro Railway?",
  "marketplace.plugin.railway.prompt.crash": "Perché il mio servizio backend su Railway va in crash durante il deploy?",
  "marketplace.plugin.railway.prompt.redeploy": "Ripeti il deploy del servizio API nel mio progetto Railway.",
  "marketplace.plugin.render.tagline": "Servizi, deploy e log",
  "marketplace.plugin.render.description":
    "Render consente agli agenti di elencare spazi di lavoro e servizi, leggere log, eventi e metriche, vedere la cronologia dei deploy, avviare deploy ed eseguire SQL in sola lettura su Render Postgres. Una chiave API di Render va in un'intestazione Authorization. La chiave raggiunge ogni spazio di lavoro dell'account Render. Gli agenti possono creare servizi web, siti statici, cron job, database Postgres e istanze Key Value, che possono avere un costo, e possono sostituire le variabili d'ambiente di un servizio. Il server non può eliminare alcuna risorsa.",
  "marketplace.plugin.render.app":
    "Servizi, deploy, log e metriche, tramite il server MCP di Render con una chiave API.",
  "marketplace.plugin.render.prompt.services": "Quali servizi ci sono nel mio spazio di lavoro Render?",
  "marketplace.plugin.render.prompt.logs": "Quali errori ha registrato il mio servizio web Render nell'ultima ora?",
  "marketplace.plugin.render.prompt.deploy": "Perché l'ultimo deploy del mio servizio Render non è riuscito?",
  "marketplace.plugin.atlassian.tagline": "Elementi di lavoro Jira e pagine Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian consente agli agenti di cercare e leggere elementi di lavoro Jira, pagine Confluence e pull request Bitbucket, e di creare o aggiornare elementi di lavoro, pagine e commenti. Ogni utente accede al proprio account Atlassian dal browser e approva l'accesso in una schermata di consenso. Gli agenti hanno gli stessi permessi dell'utente: possono modificare elementi di lavoro e pagine, modificare i permessi delle pagine ed eseguire il merge delle pull request. Gli strumenti che eliminano dati Jira restano disattivati finché un amministratore dell'organizzazione non li attiva. Ogni chiamata a uno strumento consuma crediti Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence e Bitbucket, tramite il server MCP di Atlassian con accesso dal browser.",
  "marketplace.plugin.atlassian.prompt.assigned": "Quali elementi di lavoro Jira aperti sono assegnati a me?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Trova la pagina Confluence sul nostro processo di rilascio e riassumila.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Crea un elemento di lavoro Jira per il bug di accesso con i passaggi per riprodurlo.",
  "marketplace.plugin.todoist.tagline": "Attività, progetti e promemoria",
  "marketplace.plugin.todoist.description":
    "Todoist permette agli agenti di trovare attività per data, testo, etichetta o filtro, aggiungere e ripianificare attività, e gestire progetti, sezioni, etichette, commenti e promemoria. Ogni utente accede al proprio account Todoist dal browser. Gli agenti hanno accesso in lettura e scrittura: possono modificare, completare ed eliminare attività, progetti e altri elementi.",
  "marketplace.plugin.todoist.app":
    "Attività, progetti e promemoria, tramite il server MCP di Todoist con accesso dal browser.",
  "marketplace.plugin.todoist.prompt.today": "Quali attività di Todoist scadono oggi?",
  "marketplace.plugin.todoist.prompt.capture": "Aggiungi queste azioni alla mia Posta in arrivo di Todoist.",
  "marketplace.plugin.todoist.prompt.overdue": "Sposta a domani le mie attività scadute di Todoist.",
  "marketplace.plugin.trello.tagline": "Bacheche, liste e schede",
  "marketplace.plugin.trello.description":
    "Trello permette agli agenti di cercare e leggere bacheche, liste, schede, checklist e commenti, creare bacheche e schede, spostare liste e schede, segnare le schede come completate e aggiungere checklist, commenti ed etichette. Gli agenti possono anche leggere e aggiungere schede nella Posta in arrivo di Trello dell’utente e leggere gli eventi del Planner, che possono venire da un calendario Google o Outlook collegato. Ogni utente accede al proprio account Trello dal browser e sceglie gli spazi di lavoro in una schermata di consenso. Gli agenti hanno gli stessi permessi dell’utente in quegli spazi di lavoro. Possono archiviare schede e liste, ma il server non può eliminare nulla in modo definitivo.",
  "marketplace.plugin.trello.app": "Bacheche, liste e schede, tramite il server MCP di Trello con accesso dal browser.",
  "marketplace.plugin.trello.prompt.myCards": "Quali schede di Trello sono assegnate a me?",
  "marketplace.plugin.trello.prompt.board": "Riassumi cosa è in corso sulla mia bacheca Trello.",
  "marketplace.plugin.trello.prompt.newCards": "Aggiungi queste azioni come schede alla mia bacheca Trello.",
  "marketplace.plugin.huggingface.tagline": "Modelli, dataset e paper sull'Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face permette agli agenti di cercare modelli, dataset, Spaces, collezioni e paper sull'Hugging Face Hub, leggere model card e file dei repository, vedere un'anteprima dei dataset e cercare nella documentazione di Hugging Face. Usa dati pubblici dell'Hub e non richiede account né chiave. Gli strumenti leggono soltanto: gli agenti non possono creare repository né eseguire job.",
  "marketplace.plugin.huggingface.app":
    "Ricerca di modelli, dataset, Spaces, paper e documentazione, tramite il server MCP di Hugging Face senza accesso.",
  "marketplace.plugin.huggingface.prompt.models":
    "Trova piccoli modelli aperti per il riconoscimento vocale su Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Quali paper sono di tendenza oggi su Hugging Face?",
  "marketplace.plugin.huggingface.prompt.dataset": "Trova un dataset di serie temporali meteo e mostrane le colonne.",
  "marketplace.auth.apiKey": "Chiave API",
  "marketplace.auth.personalApiKey": "Chiave API personale",
  "marketplace.auth.mcpUrl": "URL MCP",
  "marketplace.auth.createKey": "Crea una chiave",

  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Prova in {name}",
  "marketplace.skills.yours": "Le tue skill",
  "marketplace.skills.seeAll": "Mostra tutto",
  "marketplace.skills.seeAllName": "Mostra tutto: {name}",
  "marketplace.skills.none": "Nessun agente ha ancora una skill.",
  "marketplace.skills.noneHint":
    "Una skill insegna un'attività a un agente. Aggiungine una qui sotto o creane una tua.",
  "marketplace.skills.sourceLabel": "Origine",
  "marketplace.skills.source.all": "Tutte",
  "marketplace.skills.source.verified": "Verificate",
  "marketplace.skills.source.public": "Pubbliche",
  "marketplace.skills.source.verifiedLong": "Verificata da OpenBot",
  "marketplace.skills.source.publicLong": "Pubblica: OpenBot non l'ha controllata",
  "marketplace.skills.sortLabel": "Ordina",
  "marketplace.skills.sortName": "Ordina: {name}",
  "marketplace.skills.sort.installs": "Più usate",
  "marketplace.skills.sort.updated": "Aggiornate di recente",
  "marketplace.skills.sort.name": "Nome",
  "marketplace.skills.featured": "In evidenza",
  "marketplace.skills.all": "Tutte le skill",
  "marketplace.skills.count": { one: "{count} skill", other: "{count} skill" },
  "marketplace.skills.searchIn": "Cerca in {name}",
  "marketplace.skills.state.off": "Disattivata",
  "marketplace.skills.state.repair": "Da riparare",
  "marketplace.skills.state.update": "Aggiornamento disponibile",
  "marketplace.skills.state.modified": "Modificata da te",
  "marketplace.skills.stateOn": "{state} su {agents}",
  "marketplace.skills.version": "Versione {version}",
  "marketplace.skills.origin.local": "Creata su questo computer",
  "marketplace.skills.origin.workspace": "Nella cartella di questo agente",
  "marketplace.skills.origin.marketplace": "Dal Marketplace · versione {version}",
  "marketplace.skills.status.notAdded": "Non aggiunta",
  "marketplace.skills.status.on": "Attiva su {agents}",
  "marketplace.skills.agentCount": { one: "{count} agente", other: "{count} agenti" },
  "marketplace.skills.allAgents": "tutti gli agenti",
  "marketplace.skills.agentsTitle": "Agenti · {total}",
  "marketplace.skills.agents.search": "Cerca agenti",
  "marketplace.skills.agents.searchName": "Cerca gli agenti con {name}",
  "marketplace.skills.agents.noMatch": "Nessun agente corrisponde a “{query}”.",
  "marketplace.skills.agents.removeAll": "Rimuovi tutto",
  "marketplace.skills.agents.removeAllName": {
    one: "Rimuovi {name} da {count} agente",
    other: "Rimuovi {name} da tutti i {count} agenti",
  },
  "marketplace.skills.agent.toggle": "{name} per {agent}",
  "marketplace.skills.agent.remove": "Rimuovi",
  "marketplace.skills.agent.removeName": "Rimuovi {name} da {agent}",
  "marketplace.skills.add": "Aggiungi",
  "marketplace.skills.addName": "Aggiungi {name} agli agenti",
  "marketplace.skills.addToAgents": "Aggiungi agli agenti",
  "marketplace.skills.onOf": "Attiva su {have} di {total}",
  "marketplace.skills.chooseAgents": "{name} è su {agents}. Scegli gli agenti",
  "marketplace.skills.dialog.list": "Agenti con {name}",
  "marketplace.skills.dialog.search": { one: "Cerca tra {count} agente", other: "Cerca tra {count} agenti" },
  "marketplace.skills.dialog.all": { one: "{count} agente", other: "Tutti i {count} agenti" },
  "marketplace.skills.dialog.allMatches": { one: "{count} risultato", other: "Tutti i {count} risultati" },
  "marketplace.skills.dialog.checked": "{checked} di {total}",
  "marketplace.skills.dialog.save": "Salva",
  "marketplace.skills.dialog.saveBoth": "Salva: aggiungi {added}, rimuovi {removed}",
  "marketplace.skills.dialog.addTo": "Aggiungi a {agents}",
  "marketplace.skills.dialog.removeFrom": "Rimuovi da {agents}",
  "marketplace.skills.dialog.full": "Limite di skill raggiunto",
  "marketplace.skills.dialog.unread": "Skill non lette",
  "marketplace.skills.local.gone": "Nessun agente ha più questa skill.",

  "marketplace.notice.agentAdded": "{name} aggiunto.",
  "marketplace.notice.agentUpdated": "{name} aggiornato.",
  "marketplace.notice.appConnected": "{name} connessa.",
  "marketplace.notice.appDisconnected": "{name} disconnessa.",
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
