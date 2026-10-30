import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Programmierung",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Daten und Analysen",
  "marketplace.category.documents": "Dokumente",
  "marketplace.category.productivity": "Produktivität",
  "marketplace.category.research": "Recherche",
  "marketplace.category.automation": "Automatisierung",
  "marketplace.category.other": "Sonstiges",
  "marketplace.loadFailed": "Der Marketplace konnte nicht geladen werden.",
  "marketplace.loading.skills": "Fähigkeiten werden geladen",
  "marketplace.loading.agents": "Agenten werden geladen",
  "marketplace.noMatch.skills": "Keine Fähigkeiten entsprechen dieser Suche.",
  "marketplace.noMatch.agents": "Keine Agenten entsprechen dieser Suche.",
  "marketplace.loadMore": "Mehr laden",
  "marketplace.version": "Version {version}",
  "marketplace.title": "Marketplace",
  "marketplace.kinds": "Inhaltstypen im Marketplace",
  "marketplace.tab.agents": "Agenten",
  "marketplace.tab.skills": "Fähigkeiten",
  "marketplace.description.apps": "Verbinden Sie die Tools und Dienste, mit denen Ihre Agenten arbeiten.",
  "marketplace.description.agents": "Fertige Agenten mit eigenen Anweisungen und Fähigkeiten.",
  "marketplace.description.skills": "Anweisungen, die einem Agenten eine Aufgabe oder ein Tool beibringen.",
  "marketplace.plugins.missing": "Dieses Plugin ist nicht im OpenBot-Katalog.",
  "marketplace.agents.loadingDetail": "Agentendetails werden geladen…",
  "marketplace.agents.skills": "Fähigkeiten",
  "marketplace.agents.routines": "Routinen",
  "marketplace.agents.routineActive": "Aktiv",
  "marketplace.agents.routineInactive": "Inaktiv",
  "marketplace.skill.loading": "Fähigkeit wird geladen",
  "marketplace.try.readFailed": "OpenBot konnte die Fähigkeiten dieses Agenten nicht lesen. Versuche es erneut.",
  "marketplace.try.enable": "Aktiviere diese Fähigkeit in den Agenteneinstellungen, um sie auszuprobieren.",
  "marketplace.try.repair": "Repariere diese Fähigkeit in den Agenteneinstellungen, um sie auszuprobieren.",
  "marketplace.try.update": "Aktualisiere diese Fähigkeit, um diese Version auszuprobieren.",
  "marketplace.try.composerUnavailable": "Die Nachrichteneingabe des Agenten ist nicht verfügbar.",
  "marketplace.open": "{name} öffnen",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Ort",
  "marketplace.search.label": "Marketplace durchsuchen",
  "marketplace.search.placeholder": "Suchen",
  "marketplace.installs": {
    one: "{installs} Installation",
    other: "{installs} Installationen",
  },
  "marketplace.filter": "Filtern",
  "marketplace.filter.on": "Filter: {filters}",
  "marketplace.filter.all": "Alle",
  "marketplace.filter.status": "Status",
  "marketplace.filter.category": "Kategorie",
  "marketplace.filter.added": "Hinzugefügt",
  "marketplace.filter.notAdded": "Nicht hinzugefügt",
  "marketplace.filter.clear": "Filter zurücksetzen",
  "marketplace.noMatch.apps": "Keine Apps entsprechen dieser Suche.",
  "marketplace.noMatch.filters": "Keine Ergebnisse entsprechen den Filtern.",
  "marketplace.noMatch.showAgents": {
    one: "{count} Agenten anzeigen",
    other: "{count} Agenten anzeigen",
  },
  "marketplace.noMatch.showApps": {
    one: "{count} App anzeigen",
    other: "{count} Apps anzeigen",
  },
  "marketplace.noMatch.showSkills": {
    one: "{count} Fähigkeit anzeigen",
    other: "{count} Fähigkeiten anzeigen",
  },
  "marketplace.empty.agents": "Im Marketplace gibt es noch keine Agenten.",
  "marketplace.empty.apps": "Im Marketplace gibt es noch keine Apps.",
  "marketplace.empty.skills": "Im Marketplace gibt es noch keine Fähigkeiten.",
  "marketplace.properties.agent": "Über diesen Agenten",
  "marketplace.properties.creator": "Ersteller",
  "marketplace.properties.category": "Kategorie",
  "marketplace.properties.version": "Version",
  "marketplace.properties.updated": "Aktualisiert",
  "marketplace.properties.installs": "Installationen",
  "marketplace.agent.add": "Hinzufügen",
  "marketplace.agent.addNamed": "{name} hinzufügen",
  "marketplace.agent.addAgent": "Agenten hinzufügen",
  "marketplace.agent.added": "Hinzugefügt",
  "marketplace.agent.updateAvailable": "Update verfügbar",
  "marketplace.agent.update": "Aktualisieren",
  "marketplace.agent.openChat": "Chat öffnen",
  "marketplace.app.connect": "Verbinden",
  "marketplace.app.reconnect": "Neu verbinden",
  "marketplace.app.connectNamed": "{name} verbinden",
  "marketplace.app.reconnectNamed": "{name} neu verbinden",
  "marketplace.app.connected": "Verbunden",
  "marketplace.app.attention": "Handlungsbedarf",
  "marketplace.app.partialTitle": "{name} ist nicht vollständig",
  "marketplace.app.partialDescription":
    "Einige Apps oder Skills sind nicht installiert. „Neu verbinden“ installiert sie.",
  "marketplace.app.notConnected": "Nicht verbunden",
  "marketplace.app.custom": "MCP-Server",
  "marketplace.app.githubTagline": "Repositorys, Issues und Pull Requests",
  "marketplace.app.onePasswordTagline": "Bei Websites mit von dir geteilten Zugangsdaten anmelden",
  "marketplace.app.slackTagline": "Erwähnungen und Direktnachrichten in Slack",
  "marketplace.app.discordTagline": "Erwähnungen und Direktnachrichten in Discord",
  "marketplace.app.telegramTagline": "Gruppen und Direktchats in Telegram",
  "marketplace.app.bitwardenTagline": "Bei Websites mit Zugangsdaten aus einem geteilten Ordner anmelden",
  "marketplace.app.onePasswordCategory": "Verwaltung von Anmeldungen und Zugangsdaten",
  "marketplace.app.yourApps": "Deine Apps",
  "marketplace.app.addCustom": "Eigene hinzufügen",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Befehl",
  "marketplace.app.address": "Adresse",
  "marketplace.app.disconnect.title": "{name} trennen",
  "marketplace.app.disconnect.description":
    "Entferne {name} und die zugehörigen Fähigkeiten von diesem Computer. Du kannst die App später erneut verbinden.",
  "marketplace.app.disconnect.action": "Trennen",
  "marketplace.app.remove.title": "Server entfernen",
  "marketplace.app.remove.description":
    "Deine Agenten können diesen Server nicht mehr nutzen. Seine Einstellungen werden gelöscht.",
  "marketplace.app.remove.action": "Entfernen",
  "marketplace.app.remove.confirmTitle": "{name} entfernen?",
  "marketplace.app.remove.keep": "Behalten",
  "marketplace.app.connection": "Verbindung",
  "marketplace.app.setup.account": "Melde dich im Browser mit deinem {name}-Konto an.",
  "marketplace.app.setup.key": "Benötigt einen API-Schlüssel aus deinem {name}-Konto.",
  "marketplace.app.setup.keySaved": "{field} auf {host} gespeichert.",
  "marketplace.app.setup.desktop": "Läuft in der Desktop-App von {name} unter {address}.",
  "marketplace.app.setup.desktopConnected": "Verbunden mit {address}.",
  "marketplace.app.setup.open": "Keine Anmeldung und kein Schlüssel nötig.",
  "marketplace.app.connectAgain": "Erneut verbinden",
  "marketplace.app.automation.askOnInstall": "Bei Installation macOS um Zugriff bitten",
  "marketplace.app.automation.title": "Zugriff auf Apple-Apps",
  "marketplace.app.automation.description":
    "macOS zeigt für jede App eine Abfrage. Eine geschlossene App öffnet sich kurz und wird dann beendet.",
  "marketplace.app.automation.request": "Zugriff anfragen",
  "marketplace.app.automation.allowed": "OpenBot kann jetzt alle Apple-Apps steuern.",
  "marketplace.app.automation.refused":
    "macOS hat keinen Zugriff auf {apps} gegeben. Erlaube OpenBot unter Systemeinstellungen › Datenschutz & Sicherheit › Automation.",
  "marketplace.app.automation.failed": "OpenBot konnte macOS nicht nach {apps} fragen. Versuche es erneut.",
  "marketplace.app.automation.app.calendar": "Kalender",
  "marketplace.app.automation.app.contacts": "Kontakte",
  "marketplace.app.automation.app.mail": "Mail",
  "marketplace.app.automation.app.notes": "Notizen",
  "marketplace.app.automation.app.reminders": "Erinnerungen",
  "marketplace.app.automation.app.messages": "Nachrichten",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Melde dich erneut bei {name} an",
  "marketplace.app.signInDescription":
    "{name} hat die gespeicherte Anmeldung abgelehnt. Deine Agenten können die App erst wieder nutzen, wenn du dich erneut anmeldest.",
  "marketplace.plugin.aave.tagline": "Aave-Daten und -Transaktionen",
  "marketplace.plugin.aave.description":
    "Mit Aave erkundest du Live-Märkte von Aave V3 und V4, prüfst Wallet-Positionen und DAO-Governance, simulierst Kreditaktionen und bereitest nicht verwahrte Transaktionen vor. Jede Transaktion wird unsigniert zurückgegeben: Das Plugin liest die Märkte und schreibt den Aufruf, und die Wallet bleibt beim Nutzer.",
  "marketplace.plugin.aave.app":
    "Live-Märkte von V3 und V4, Wallet-Positionen, DAO-Governance und vorbereitete Transaktionen über einen MCP-Server.",
  "marketplace.plugin.aave.prompt.stablecoinYield": "Wo kann ich gerade auf Aave am meisten mit Stablecoins verdienen?",
  "marketplace.plugin.aave.prompt.usdcRates": "Was zahlt gerade mehr für USDC, Aave V3 oder V4 auf Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Wie hoch ist der Health Factor von 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, und wie weit ist er von der Liquidation entfernt?",
  "marketplace.plugin.canva.tagline": "Designs, Assets und Exporte",
  "marketplace.plugin.canva.description":
    "Mit Canva erstellst und bearbeitest du Designs mit Worten, durchsuchst deine eigene Designbibliothek, lädst Assets hoch und organisierst sie, exportierst im Format, das ein Kanal braucht, und hinterlässt Kommentare direkt an der Arbeit. Jeder Nutzer meldet sich bei seinem eigenen Canva-Konto an, und der Agent kann alles, was dieses Konto kann.",
  "marketplace.plugin.canva.app":
    "Designs erstellen und bearbeiten, Bibliothekssuche, Asset- und Markenverwaltung, Exporte und Kommentare über einen MCP-Server.",
  "marketplace.plugin.canva.prompt.recentDesign": "Zeig mir mein zuletzt bearbeitetes Canva-Design.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Passe die Größe meines Launch-Posters für Instagram an und exportiere beide als PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Mach aus diesen Versionshinweisen eine Canva-Präsentation mit sechs Folien.",
  "marketplace.plugin.linear.tagline": "Issues und Projekt-Triage",
  "marketplace.plugin.linear.description":
    "Mit Linear listen Agenten zugewiesene Issues auf, sichten den Backlog, aktualisieren Status und entwerfen neue Issues im Arbeitsbereich, zu dem das angemeldete Konto gehört. Jeder Nutzer meldet sich im Browser bei seinem eigenen Linear-Konto an.",
  "marketplace.plugin.linear.app":
    "Issue-Suche, Triage, Statusaktualisierungen und Issue-Erstellung über den MCP-Server von Linear mit Anmeldung im Browser.",
  "marketplace.plugin.linear.prompt.myWeek": "Was ist mir diese Woche zugewiesen?",
  "marketplace.plugin.linear.prompt.backlog":
    "Sichte den Backlog: Was ist veraltet, blockiert oder hat keinen Verantwortlichen?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Erstelle ein Issue für den Absturz in der Sync-Warteschlange mit Schritten zur Reproduktion.",
  "marketplace.plugin.notion.tagline": "Dokumente und Wissensdatenbank",
  "marketplace.plugin.notion.description":
    "Mit Notion lesen und schreiben Agenten Seiten, durchsuchen den Arbeitsbereich und legen Besprechungsnotizen und Spezifikationen dort ab, wo das Team bereits arbeitet. Jeder Nutzer meldet sich im Browser bei seinem eigenen Notion-Konto an.",
  "marketplace.plugin.notion.app":
    "Seitensuche, Lesen, Schreiben und Navigation im Arbeitsbereich über den MCP-Server von Notion mit Anmeldung im Browser.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Finde die aktuelle Launch-Spezifikation und fasse die offenen Fragen zusammen.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Mach aus diesen Stichpunkten eine strukturierte Besprechungsnotiz in meinem Teambereich.",
  "marketplace.plugin.notion.prompt.updateDoc":
    "Aktualisiere das Onboarding-Dokument mit der neuen Release-Checkliste.",
  "marketplace.plugin.cobrain.tagline": "Gemeinsames Gedächtnis für deine KI-Agenten",
  "marketplace.plugin.cobrain.description":
    "Cobrain ist ein Markdown-Gedächtnis, das jede verbundene KI lesen und beschreiben kann. Agenten laden vor der Arbeit den Kontext eines Kunden oder Projekts, durchsuchen frühere Notizen und Entscheidungen und speichern, was sie lernen, damit die nächste Unterhaltung dort beginnt, wo die letzte endete. Jeder Nutzer meldet sich bei seinem eigenen Cobrain-Konto an.",
  "marketplace.plugin.cobrain.app":
    "Notizen in deinem Cobrain-Gehirn lesen, durchsuchen und schreiben, über einen MCP-Server.",
  "marketplace.plugin.cobrain.prompt.startSession":
    "Lade meinen Cobrain-Kontext für dieses Projekt, bevor wir anfangen.",
  "marketplace.plugin.cobrain.prompt.searchDecision":
    "Durchsuche meine Cobrain-Notizen danach, was wir zu den Preisen entschieden haben.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Speichere in Cobrain eine Notiz mit dem, was wir heute erledigt haben und was noch offen ist.",
  "marketplace.plugin.figma.tagline": "Designs und Prototypen",
  "marketplace.plugin.figma.description":
    "Mit Figma lesen Agenten Designdateien, prüfen Komponenten, Stile und Variablen und übergeben Produktionsspezifikationen an Entwickler. Es verbindet sich mit dem MCP-Server in der Figma-Desktop-App auf diesem Computer. Der Server kann Designs nur lesen; Schreibunterstützung ist in Arbeit.",
  "marketplace.plugin.figma.app":
    "Designkontext, Metadaten, Variablen und Screenshots über den MCP-Server in der Figma-Desktop-App. Vorerst nur lesend.",
  "marketplace.plugin.figma.prompt.handoff": "Übergib die Checkout-Datei: Liste Screens, Komponenten und Stile auf.",
  "marketplace.plugin.figma.prompt.audit": "Prüfe diese Datei auf uneinheitliche Abstände und Farbverwendung.",
  "marketplace.plugin.figma.prompt.assets": "Exportiere die Marketing-Icons in 2x für das App-Bundle.",
  "marketplace.plugin.paper.tagline": "Design-Canvas auf Basis von HTML und CSS",
  "marketplace.plugin.paper.description":
    "Mit Paper lesen und schreiben Agenten die Designdatei, die in Paper Desktop geöffnet ist: Sie prüfen Artboards, Auswahlen, berechnete Stile, JSX und Tokens und erstellen oder ändern Frames, Text und Stile. Installiere Paper Desktop, öffne es einmal und öffne eine Datei, bevor du beginnst. OpenBot startet die Paper CLI, die Paper Desktop installiert. Paper braucht keinen Schlüssel. Schreibwerkzeuge ändern die geöffnete Datei, prüfe also jeden Schreibvorgang, bevor du ihn genehmigst.",
  "marketplace.plugin.paper.app":
    "Liest und schreibt die geöffnete Paper-Desktop-Datei über den lokalen MCP-Server, den die Paper CLI weiterleitet. Benötigt Paper Desktop mit einer geöffneten Datei.",
  "marketplace.plugin.paper.prompt.implement":
    "Implementiere den ausgewählten Paper-Frame in dieser Codebasis nach unseren Code-Konventionen.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Verwende die Stile in diesem Repository und gestalte eine Einstellungsseite in Paper.",
  "marketplace.plugin.paper.prompt.tokens":
    "Liste die Design-Tokens in der geöffneten Paper-Datei auf und vergleiche sie mit unserem Theme.",
  "marketplace.plugin.appleApps.tagline": "Mail, Kalender und mehr auf deinem Mac",
  "marketplace.plugin.appleApps.description":
    "Mit Apple apps nutzen Agenten Mail, Kalender, Kontakte, Erinnerungen, Notizen, Nachrichten und Safari auf diesem Mac. Es funktioniert nur unter macOS. OpenBot startet mcp-icloud, einen Community-Server, der nicht von Apple oder OpenBot stammt. Der Server steuert die Apps über AppleScript auf diesem Computer und braucht kein Konto und keinen Schlüssel. Bei der Installation kann OpenBot macOS auf einmal um Zugriff auf alle diese Apps bitten, mit einer Abfrage pro App. Sonst fragt macOS, wenn ein Agent eine App zum ersten Mal nutzt. Um das später zu ändern, öffne Systemeinstellungen › Datenschutz & Sicherheit › Automation. Agenten können E-Mails und iMessages senden und Termine, Kontakte und Erinnerungen ändern oder löschen, prüfe also jeden Schreibvorgang, bevor du ihn genehmigst. Was die Werkzeuge lesen, etwa E-Mail-Text, geht an den Modellanbieter des Agenten.",
  "marketplace.plugin.appleApps.app":
    "Mail, Kalender, Kontakte, Erinnerungen, Notizen, Nachrichten und Safari über den lokalen Server mcp-icloud. Benötigt macOS und Zugriff unter Automation.",
  "marketplace.plugin.appleApps.prompt.unread": "Fasse meine ungelesenen E-Mails von heute in Apple Mail zusammen.",
  "marketplace.plugin.appleApps.prompt.today": "Was steht heute und morgen in meinem Apple-Kalender?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Finde die neueste E-Mail zum Projekttreffen und trage das Treffen in meinen Kalender ein.",
  "marketplace.plugin.sentry.tagline": "Fehler- und Absturz-Triage",
  "marketplace.plugin.sentry.description":
    "Mit Sentry durchsuchen Agenten aktuelle Fehler, prüfen Stacktraces und betroffene Releases und fassen zusammen, was nach einem Deployment kaputtgegangen ist. Jeder Nutzer meldet sich im Browser bei seinem eigenen Sentry-Konto an.",
  "marketplace.plugin.sentry.app":
    "Fehlersuche, Issue-Prüfung und Release-Zustand über den MCP-Server von Sentry mit Anmeldung im Browser.",
  "marketplace.plugin.sentry.prompt.newErrors": "Welche neuen Fehler sind seit dem gestrigen Deployment aufgetreten?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Erkläre den häufigsten Absturz im Mobile-Projekt und seine wahrscheinliche Ursache.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Wie stabil ist das aktuelle Release im Vergleich zum letzten?",
  "marketplace.plugin.vercel.tagline": "Deployments, Build-Logs und Projekte",
  "marketplace.plugin.vercel.description":
    "Mit Vercel listen Agenten Projekte und aktuelle Deployments auf, lesen Build- und Laufzeit-Logs und finden heraus, warum ein Build fehlgeschlagen ist. Jeder Nutzer meldet sich im Browser bei seinem eigenen Vercel-Konto an und wählt die Teams, die Agenten nutzen dürfen. In diesen Teams haben Agenten dieselben Rechte wie das Konto des Nutzers. Sie können auch Umgebungsvariablen, Domains, DNS-Einträge und Deployments ändern und Domains kaufen.",
  "marketplace.plugin.vercel.app":
    "Projekte, Deployments, Build-Logs und Laufzeit-Logs über den MCP-Server von Vercel mit Anmeldung im Browser.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Warum ist das letzte Production-Deployment fehlgeschlagen?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Liste die heutigen Deployments und ihren Status auf.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "Welche Routen hatten in der letzten Stunde Laufzeitfehler?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, Speicher und Logs",
  "marketplace.plugin.cloudflare.description":
    "Mit Cloudflare listen Agenten Workers, DNS-Einträge, R2, D1 und KV über die Cloudflare-API auf und verwalten sie, fragen Workers-Logs ab und durchsuchen die Cloudflare-Dokumentation. Jeder Nutzer meldet sich im Browser bei seinem eigenen Cloudflare-Konto an. Wähle auf der Zustimmungsseite von Cloudflare Read only: Mit der Voreinstellung Minimal sehen Agenten keine Workers, Logs oder DNS-Einträge. Mit Schreibrechten können Agenten Workers bereitstellen und löschen, DNS-Einträge ändern und weitere Kontoeinstellungen ändern.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, Speicher und Logs über den API-MCP-Server von Cloudflare mit Anmeldung im Browser.",
  "marketplace.plugin.cloudflare.prompt.workers": "Welche Workers sind in meinem Cloudflare-Konto bereitgestellt?",
  "marketplace.plugin.cloudflare.prompt.errors":
    "Welche Cloudflare Workers haben in der letzten Stunde Fehler protokolliert?",
  "marketplace.plugin.cloudflare.prompt.dns": "Liste die DNS-Einträge jeder Zone in meinem Cloudflare-Konto auf.",
  "marketplace.plugin.supabase.tagline": "Datenbanken, Logs und Edge Functions",
  "marketplace.plugin.supabase.description":
    "Mit Supabase listen Agenten Projekte auf, führen SQL aus, lesen Tabellenschemas und Logs, prüfen die Sicherheits- und Leistungshinweise der Advisors, verwalten Edge Functions und Branches und durchsuchen die Supabase-Dokumentation. Jeder Nutzer meldet sich im Browser bei seinem eigenen Supabase-Konto an und wählt eine Organisation. Agenten erhalten vollen Zugriff: Sie können SQL ausführen, das Daten ändert oder löscht, Migrationen anwenden, Edge Functions bereitstellen und Projekte erstellen oder pausieren.",
  "marketplace.plugin.supabase.app":
    "Datenbanken, Logs und Edge Functions über den MCP-Server von Supabase mit Anmeldung im Browser.",
  "marketplace.plugin.supabase.prompt.projects": "Welche Projekte gibt es in meiner Supabase-Organisation?",
  "marketplace.plugin.supabase.prompt.tables": "Liste die Tabellen und Spalten meiner Supabase-Datenbank auf.",
  "marketplace.plugin.supabase.prompt.errors":
    "Welche Fehler hat mein Supabase-Projekt in der letzten Stunde protokolliert?",
  "marketplace.plugin.context7.tagline": "Aktuelle Bibliotheksdokumentation",
  "marketplace.plugin.context7.description":
    "Context7 ruft aktuelle Dokumentation und API-Referenzen für Bibliotheken und Frameworks ab, damit Antworten die Version verwenden, die das Projekt tatsächlich nutzt. Es braucht kein Konto und keinen Schlüssel.",
  "marketplace.plugin.context7.app":
    "Suche in aktueller Bibliotheksdokumentation über den MCP-Server von Context7 ohne Anmeldung.",
  "marketplace.plugin.context7.prompt.apiCheck":
    "Wie lautet die aktuelle API für virtualisierte Listen in diesem Framework?",
  "marketplace.plugin.context7.prompt.migrate": "Was hat sich zwischen v2 und v3 dieses Routers geändert?",
  "marketplace.plugin.context7.prompt.example": "Zeig ein aktuelles Beispiel für authentifizierte Datei-Uploads.",
  "marketplace.plugin.stripe.tagline": "Zahlungen und Abrechnung prüfen",
  "marketplace.plugin.stripe.description":
    "Mit Stripe suchen Agenten Zahlungen, Kunden und Rechnungen und entwerfen Zahlungslinks in dem Konto, auf das der angemeldete Nutzer zugreifen kann. Jeder Nutzer meldet sich im Browser bei seinem eigenen Stripe-Konto an.",
  "marketplace.plugin.stripe.app":
    "Suche nach Zahlungen, Kunden und Rechnungen über den MCP-Server von Stripe mit Anmeldung im Browser.",
  "marketplace.plugin.stripe.prompt.payment": "Suche diese Zahlung und erkläre, warum sie fehlgeschlagen ist.",
  "marketplace.plugin.stripe.prompt.customer": "Fasse die Rechnungen und den offenen Saldo dieses Kunden zusammen.",
  "marketplace.plugin.stripe.prompt.link": "Entwirf einen Zahlungslink für den Pro-Tarif zu 49 pro Monat.",
  "marketplace.plugin.posthog.tagline": "Produktanalysen und Flags",
  "marketplace.plugin.posthog.description":
    "Mit PostHog fragen Agenten Events und Funnels ab, prüfen Feature-Flags und fassen zusammen, was sich nach einem Release geändert hat. Ein persönlicher API-Schlüssel aus den Projekteinstellungen kommt in einen Authorization-Header.",
  "marketplace.plugin.posthog.app":
    "Zugriff auf Events, Funnels und Feature-Flags über den MCP-Server von PostHog mit einem persönlichen API-Schlüssel.",
  "marketplace.plugin.posthog.prompt.funnel": "Wie sieht der Registrierungs-Funnel für die letzten 14 Tage aus?",
  "marketplace.plugin.posthog.prompt.flag": "Welche Feature-Flags sind für diesen Nutzer aktiviert?",
  "marketplace.plugin.posthog.prompt.release": "Hat sich die Aktivierung nach dem Release letzter Woche verändert?",
  "marketplace.plugin.airtable.tagline": "Bases und Datensätze",
  "marketplace.plugin.airtable.description":
    "Mit Airtable listen Agenten Bases auf, lesen und aktualisieren Datensätze und fassen Tabelleninhalte zusammen. Ein API-Schlüssel von der Kontoseite wird dem lokalen Server als eine Umgebungsvariable übergeben.",
  "marketplace.plugin.airtable.app":
    "Auflistung von Bases und Zugriff auf Datensätze über einen lokalen MCP-Server mit einem Airtable-API-Schlüssel.",
  "marketplace.plugin.airtable.prompt.bases": "Auf welche Bases habe ich Zugriff?",
  "marketplace.plugin.airtable.prompt.records": "Fasse die Launch-Tracker-Tabelle zusammen.",
  "marketplace.plugin.airtable.prompt.update":
    "Markiere die ausgelieferten Funktionen in der Roadmap-Base als erledigt.",
  "marketplace.plugin.firecrawl.tagline": "Web-Extraktion und Suche",
  "marketplace.plugin.firecrawl.description":
    "Mit Firecrawl scrapen Agenten Seiten, extrahieren strukturierte Daten und durchsuchen das Web über eine API. Ein API-Schlüssel aus dem Firecrawl-Dashboard wird dem lokalen Server als eine Umgebungsvariable übergeben.",
  "marketplace.plugin.firecrawl.app":
    "Scraping von Seiten, Extraktion und Websuche über einen lokalen MCP-Server mit einem Firecrawl-API-Schlüssel.",
  "marketplace.plugin.firecrawl.prompt.scrape": "Extrahiere die Preistabelle von dieser Seite als strukturierte Daten.",
  "marketplace.plugin.firecrawl.prompt.research": "Recherchiere die Preise der Konkurrenz und nenne jede Quellseite.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Was hat sich diesen Monat auf unserer Changelog-Seite geändert?",
  "marketplace.plugin.braveSearch.tagline": "Private Websuche",
  "marketplace.plugin.braveSearch.description":
    "Mit Brave Search durchsuchen Agenten das Web und lokale Ergebnisse ohne Tracking. Ein API-Schlüssel aus dem Brave-Search-API-Dashboard wird dem lokalen Server als eine Umgebungsvariable übergeben.",
  "marketplace.plugin.braveSearch.app":
    "Web- und lokale Suche über einen lokalen MCP-Server mit einem Brave-API-Schlüssel.",
  "marketplace.plugin.braveSearch.prompt.search": "Was sagen Rezensenten über diese Framework-Version?",
  "marketplace.plugin.braveSearch.prompt.news": "Finde die heutigen Ankündigungen für diesen Produktbereich.",
  "marketplace.plugin.braveSearch.prompt.compare": "Vergleiche diese beiden Anbieter mit Quellenangaben.",
  "marketplace.plugin.obsidian.tagline": "Notizen in deinem Vault",
  "marketplace.plugin.obsidian.description":
    "Mit Obsidian können Agenten die Notizen in deinem Vault durchsuchen, lesen und schreiben, sodass der Vault ihr Gedächtnis sein kann. Der lokale Server verbindet sich mit dem Plugin Local REST API in der Obsidian-App auf diesem Computer. Der API-Schlüssel des Plugins wird dem lokalen Server als eine Umgebungsvariable übergeben. Lass Obsidian geöffnet, solange Agenten es nutzen.",
  "marketplace.plugin.obsidian.app":
    "Notizen suchen, lesen und bearbeiten, über einen lokalen MCP-Server mit dem Schlüssel des Plugins Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Was steht in meinen Notizen zu den Entscheidungen in diesem Projekt?",
  "marketplace.plugin.obsidian.prompt.save": "Speichere diese Entscheidung als neue Notiz in meinem Vault.",
  "marketplace.plugin.obsidian.prompt.log":
    "Füge eine Zusammenfassung der heutigen Arbeit zu meiner Notiz Arbeitsprotokoll hinzu.",
  "marketplace.plugin.obsidian.hint.apiKey":
    'Öffne in Obsidian Settings > Local REST API. Kopiere den API-Schlüssel und aktiviere "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "Transaktions-E-Mails",
  "marketplace.plugin.resend.description":
    "Mit Resend senden Agenten Transaktions-E-Mails und prüfen die Zustellung über eine API. Ein API-Schlüssel aus dem Resend-Dashboard wird dem lokalen Server als eine Umgebungsvariable übergeben.",
  "marketplace.plugin.resend.app":
    "E-Mail-Versand und Zustellungsprüfung über einen lokalen MCP-Server mit einem Resend-API-Schlüssel.",
  "marketplace.plugin.resend.prompt.send": "Sende den Entwurf der Launch-Ankündigung an die Beta-Liste.",
  "marketplace.plugin.resend.prompt.status": "Hat die Rechnungs-E-Mail den Kunden erreicht?",
  "marketplace.plugin.resend.prompt.template":
    "Entwirf eine E-Mail zum Zurücksetzen des Passworts für den neuen Ablauf.",
  "marketplace.plugin.composio.tagline": "Viele Apps über deinen eigenen Composio-Link",
  "marketplace.plugin.composio.description":
    "Composio verbindet Agenten über einen MCP-Server mit Gmail, Slack, GitHub und Hunderten weiterer Apps. Verbinde die gewünschten Apps in deinem Composio-Konto und füge dann hier seine MCP-URL und seinen API-Schlüssel ein.",
  "marketplace.plugin.composio.app":
    "Die Apps, die du deinem Composio-MCP-Server hinzufügst, über den Link aus deinem Composio-Konto.",
  "marketplace.plugin.composio.prompt.inbox":
    "Fasse meine ungelesenen E-Mails zusammen und entwirf Antworten auf die dringenden.",
  "marketplace.plugin.composio.prompt.handoff": "Poste eine Zusammenfassung dieses Pull Requests in unseren Teamkanal.",
  "marketplace.plugin.composio.prompt.apps": "Welche Apps und Aktionen kannst du über Composio nutzen?",
  "marketplace.plugin.composio.hint.url": "Die URL eines MCP-Servers in deinem Composio-Konto",
  "marketplace.plugin.composio.hint.apiKey":
    "Du findest ihn in deinem Composio-Konto unter Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Postgres-Projekte, Branches und Migrationen",
  "marketplace.plugin.neon.description":
    "Mit Neon listen Agenten Projekte und Branches auf, führen SQL aus, lesen Tabellenschemas, testen Schemaänderungen in einem temporären Branch, finden langsame Abfragen und durchsuchen die Neon-Dokumentation. Jeder Nutzer meldet sich im Browser bei seinem eigenen Neon-Konto an und kann bei der Autorisierung Lesezugriff wählen. Mit vollem Zugriff können Agenten SQL ausführen, das Daten ändert oder löscht, und Branches, Datenbanken und Projekte erstellen, zurücksetzen oder löschen. Neon empfiehlt seinen MCP-Server für Entwicklung und Tests, nicht für Produktionsdatenbanken.",
  "marketplace.plugin.neon.app":
    "Postgres-Projekte, Branches, SQL und Migrationen über den MCP-Server von Neon mit Anmeldung im Browser.",
  "marketplace.plugin.neon.prompt.projects": "Welche Projekte und Branches gibt es in meinem Neon-Konto?",
  "marketplace.plugin.neon.prompt.slowQueries":
    "Welche Abfragen sind in meiner Neon-Datenbank am langsamsten, und warum?",
  "marketplace.plugin.neon.prompt.migration":
    "Füge in einem temporären Branch einen Index für die Tabelle orders hinzu und zeig mir das Ergebnis, bevor du ihn anwendest.",
  "marketplace.plugin.prisma.tagline": "Postgres-Datenbanken, Backups und Compute-Apps",
  "marketplace.plugin.prisma.description":
    "Mit Prisma listen Agenten Prisma-Postgres-Datenbanken auf und erstellen sie, lesen Schemas, führen SQL aus, listen Backups auf und stellen sie in einer neuen Datenbank wieder her, verwalten Object-Storage-Buckets, lesen Compute-Builds und -Logs und durchsuchen die Prisma-Dokumentation. Jeder Nutzer meldet sich im Browser bei seinem eigenen Prisma-Konto an und wählt einen Workspace. Agenten erhalten vollen Zugriff: Sie können SQL ausführen, das Daten ändert oder löscht, Schemas aktualisieren, Datenbanken und Buckets löschen sowie Compute-Deployments stoppen, zurücksetzen oder löschen.",
  "marketplace.plugin.prisma.app":
    "Datenbanken, SQL, Backups und Compute-Apps über den MCP-Server von Prisma mit Anmeldung im Browser.",
  "marketplace.plugin.prisma.prompt.databases": "Welche Datenbanken gibt es in meinem Prisma-Workspace?",
  "marketplace.plugin.prisma.prompt.backups": "Zeig mir alle verfügbaren Backups meiner Datenbank.",
  "marketplace.plugin.prisma.prompt.logs": "Zeig mir die Laufzeit-Logs meines neuesten Compute-Deployments.",
  "marketplace.plugin.netlify.tagline": "Projekte, Deploys und Request-Logs",
  "marketplace.plugin.netlify.description":
    "Mit Netlify listen Agenten Projekte und Deploys auf, lesen Edge-Request-Logs, erstellen Projekte und deployen Code in ein bestehendes Projekt. Jeder Nutzer meldet sich im Browser bei seinem eigenen Netlify-Konto an. Agenten haben denselben Zugriff wie das Konto des Nutzers: Sie können Umgebungsvariablen, Formulare und den Besucherzugriff ändern, Erweiterungen installieren oder entfernen sowie Formulareinsendungen und Umgebungsvariablen löschen.",
  "marketplace.plugin.netlify.app":
    "Projekte, Deploys, Request-Logs und Website-Einstellungen über den MCP-Server von Netlify mit Anmeldung im Browser.",
  "marketplace.plugin.netlify.prompt.latestDeploy":
    "Welchen Status hat der neueste Deploy jedes meiner Netlify-Projekte?",
  "marketplace.plugin.netlify.prompt.errors":
    "Welche URLs meiner Website haben am letzten Tag Serverfehler zurückgegeben?",
  "marketplace.plugin.netlify.prompt.deploy": "Deploye diesen Ordner in mein bestehendes Netlify-Projekt.",
  "marketplace.plugin.railway.tagline": "Projekte, Dienste und Deployments",
  "marketplace.plugin.railway.description":
    "Mit Railway listen Agenten Projekte und Dienste auf, erstellen Projekte, deployen Dienste erneut und verwalten Feature-Flags. Agenten können auch mehrstufige Arbeit an den Railway Agent übergeben. Er liest Logs, findet heraus, warum ein Deployment fehlgeschlagen ist, erstellt Dienste und setzt Variablen. Jeder Nutzer meldet sich im Browser bei seinem eigenen Railway-Konto an und wählt die Workspaces und Projekte, die Agenten nutzen dürfen. In diesen Projekten haben Agenten vollen Zugriff: Sie können vorgemerkte Änderungen deployen, Feature-Flags löschen und über den Railway Agent Dienste, Variablen, Datenbanken und Netzwerk ändern.",
  "marketplace.plugin.railway.app":
    "Projekte, Dienste und Deployments über den MCP-Server von Railway mit Anmeldung im Browser.",
  "marketplace.plugin.railway.prompt.projects": "Welche Projekte und Dienste sind in meinem Railway-Workspace?",
  "marketplace.plugin.railway.prompt.crash": "Warum stürzt mein Backend-Dienst auf Railway beim Deployment ab?",
  "marketplace.plugin.railway.prompt.redeploy": "Deploye den API-Dienst in meinem Railway-Projekt erneut.",
  "marketplace.plugin.render.tagline": "Dienste, Deployments und Logs",
  "marketplace.plugin.render.description":
    "Mit Render listen Agenten Workspaces und Dienste auf, lesen Logs, Ereignisse und Metriken, sehen den Deployment-Verlauf, starten Deployments und führen schreibgeschütztes SQL auf Render Postgres aus. Ein Render-API-Schlüssel kommt in einen Authorization-Header. Der Schlüssel erreicht jeden Workspace des Render-Kontos. Agenten können Webdienste, statische Websites, Cronjobs, Postgres-Datenbanken und Key-Value-Instanzen erstellen, was Kosten verursachen kann, und sie können die Umgebungsvariablen eines Dienstes ersetzen. Der Server kann keine Ressource löschen.",
  "marketplace.plugin.render.app":
    "Dienste, Deployments, Logs und Metriken über den MCP-Server von Render mit einem API-Schlüssel.",
  "marketplace.plugin.render.prompt.services": "Welche Dienste sind in meinem Render-Workspace?",
  "marketplace.plugin.render.prompt.logs":
    "Welche Fehler hat mein Render-Webdienst in der letzten Stunde protokolliert?",
  "marketplace.plugin.render.prompt.deploy": "Warum ist das letzte Deployment meines Render-Dienstes fehlgeschlagen?",
  "marketplace.plugin.atlassian.tagline": "Jira-Arbeitselemente und Confluence-Seiten",
  "marketplace.plugin.atlassian.description":
    "Mit Atlassian durchsuchen und lesen Agenten Jira-Arbeitselemente, Confluence-Seiten und Bitbucket-Pull-Requests und erstellen oder aktualisieren Arbeitselemente, Seiten und Kommentare. Jeder Nutzer meldet sich im Browser bei seinem eigenen Atlassian-Konto an und bestätigt den Zugriff auf einer Zustimmungsseite. Agenten haben dieselben Rechte wie der Nutzer: Sie können Arbeitselemente und Seiten ändern, Seitenberechtigungen ändern und Pull-Requests mergen. Tools, die Jira-Daten löschen, bleiben aus, bis ein Organisationsadmin sie einschaltet. Jeder Tool-Aufruf verbraucht Rovo-Credits.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence und Bitbucket über den MCP-Server von Atlassian mit Anmeldung im Browser.",
  "marketplace.plugin.atlassian.prompt.assigned": "Welche offenen Jira-Arbeitselemente sind mir zugewiesen?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Finde die Confluence-Seite zu unserem Release-Prozess und fasse sie zusammen.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Erstelle ein Jira-Arbeitselement für den Login-Fehler mit Schritten zur Reproduktion.",
  "marketplace.plugin.todoist.tagline": "Aufgaben, Projekte und Erinnerungen",
  "marketplace.plugin.todoist.description":
    "Mit Todoist finden Agenten Aufgaben nach Datum, Text, Label oder Filter, legen Aufgaben an, planen sie um und verwalten Projekte, Abschnitte, Labels, Kommentare und Erinnerungen. Jeder Nutzer meldet sich im Browser bei seinem eigenen Todoist-Konto an. Agenten erhalten Lese- und Schreibzugriff: Sie können Aufgaben, Projekte und andere Elemente ändern, abschließen und löschen.",
  "marketplace.plugin.todoist.app":
    "Aufgaben, Projekte und Erinnerungen über den MCP-Server von Todoist mit Anmeldung im Browser.",
  "marketplace.plugin.todoist.prompt.today": "Welche Todoist-Aufgaben sind heute fällig?",
  "marketplace.plugin.todoist.prompt.capture": "Füge diese To-dos meinem Todoist-Eingang hinzu.",
  "marketplace.plugin.todoist.prompt.overdue": "Verschiebe meine überfälligen Todoist-Aufgaben auf morgen.",
  "marketplace.plugin.trello.tagline": "Boards, Listen und Karten",
  "marketplace.plugin.trello.description":
    "Mit Trello durchsuchen und lesen Agenten Boards, Listen, Karten, Checklisten und Kommentare, erstellen Boards und Karten, verschieben Listen und Karten, markieren Karten als erledigt und fügen Checklisten, Kommentare und Labels hinzu. Agenten können auch Karten im Trello-Eingang des Nutzers lesen und hinzufügen und Planner-Termine lesen, die aus einem verbundenen Google- oder Outlook-Kalender kommen können. Jeder Nutzer meldet sich im Browser bei seinem eigenen Trello-Konto an und wählt die Workspaces auf einer Zustimmungsseite. Agenten haben in diesen Workspaces dieselben Rechte wie der Nutzer. Sie können Karten und Listen archivieren, aber der Server kann nichts endgültig löschen.",
  "marketplace.plugin.trello.app": "Boards, Listen und Karten über den MCP-Server von Trello mit Anmeldung im Browser.",
  "marketplace.plugin.trello.prompt.myCards": "Welche Trello-Karten sind mir zugewiesen?",
  "marketplace.plugin.trello.prompt.board": "Fasse zusammen, was auf meinem Trello-Board gerade in Arbeit ist.",
  "marketplace.plugin.trello.prompt.newCards": "Füge diese To-dos als Karten zu meinem Trello-Board hinzu.",
  "marketplace.plugin.huggingface.tagline": "Modelle, Datensätze und Paper auf dem Hub",
  "marketplace.plugin.huggingface.description":
    "Mit Hugging Face durchsuchen Agenten Modelle, Datensätze, Spaces, Collections und Paper auf dem Hugging Face Hub, lesen Model Cards und Repository-Dateien, zeigen eine Vorschau von Datensätzen und durchsuchen die Hugging-Face-Dokumentation. Es verwendet öffentliche Hub-Daten und braucht kein Konto und keinen Schlüssel. Die Tools lesen nur: Agenten können keine Repositorys anlegen und keine Jobs ausführen.",
  "marketplace.plugin.huggingface.app":
    "Suche nach Modellen, Datensätzen, Spaces, Papern und Dokumentation über den MCP-Server von Hugging Face ohne Anmeldung.",
  "marketplace.plugin.huggingface.prompt.models": "Finde kleine offene Modelle für Spracherkennung auf Hugging Face.",
  "marketplace.plugin.huggingface.prompt.papers": "Welche Paper sind heute auf Hugging Face im Trend?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Finde einen Datensatz mit Wetter-Zeitreihen und zeig seine Spalten.",
  "marketplace.auth.apiKey": "API-Schlüssel",
  "marketplace.auth.personalApiKey": "Persönlicher API-Schlüssel",
  "marketplace.auth.mcpUrl": "MCP-URL",
  "marketplace.auth.createKey": "Schlüssel erstellen",
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "In {name} ausprobieren",
  "marketplace.skills.yours": "Deine Fähigkeiten",
  "marketplace.skills.seeAll": "Alle anzeigen",
  "marketplace.skills.seeAllName": "Alle anzeigen: {name}",
  "marketplace.skills.none": "Noch kein Agent hat eine Fähigkeit.",
  "marketplace.skills.noneHint":
    "Eine Fähigkeit bringt einem Agenten eine Aufgabe bei. Füge unten eine hinzu oder erstelle deine eigene.",
  "marketplace.skills.sourceLabel": "Quelle",
  "marketplace.skills.source.all": "Alle",
  "marketplace.skills.source.verified": "Geprüft",
  "marketplace.skills.source.public": "Öffentlich",
  "marketplace.skills.source.verifiedLong": "Von OpenBot geprüft",
  "marketplace.skills.source.publicLong": "Öffentlich: OpenBot hat sie nicht geprüft",
  "marketplace.skills.sortLabel": "Sortieren",
  "marketplace.skills.sortName": "Sortieren: {name}",
  "marketplace.skills.sort.installs": "Meistgenutzt",
  "marketplace.skills.sort.updated": "Kürzlich aktualisiert",
  "marketplace.skills.sort.name": "Name",
  "marketplace.skills.featured": "Empfohlen",
  "marketplace.skills.all": "Alle Fähigkeiten",
  "marketplace.skills.count": { one: "{count} Fähigkeit", other: "{count} Fähigkeiten" },
  "marketplace.skills.searchIn": "{name} durchsuchen",
  "marketplace.skills.state.off": "Aus",
  "marketplace.skills.state.repair": "Reparatur nötig",
  "marketplace.skills.state.update": "Update verfügbar",
  "marketplace.skills.state.modified": "Von dir geändert",
  "marketplace.skills.stateOn": "{state} bei {agents}",
  "marketplace.skills.version": "Version {version}",
  "marketplace.skills.origin.local": "Auf diesem Computer erstellt",
  "marketplace.skills.origin.workspace": "Im Ordner dieses Agenten",
  "marketplace.skills.origin.marketplace": "Aus dem Marketplace · Version {version}",
  "marketplace.skills.status.notAdded": "Nicht hinzugefügt",
  "marketplace.skills.status.on": "Aktiv bei {agents}",
  "marketplace.skills.agentCount": { one: "{count} Agent", other: "{count} Agenten" },
  "marketplace.skills.allAgents": "allen Agenten",
  "marketplace.skills.agentsTitle": "Agenten · {total}",
  "marketplace.skills.agents.search": "Agenten suchen",
  "marketplace.skills.agents.searchName": "Agenten mit {name} suchen",
  "marketplace.skills.agents.noMatch": "Kein Agent passt zu „{query}“.",
  "marketplace.skills.agents.removeAll": "Alle entfernen",
  "marketplace.skills.agents.removeAllName": {
    one: "{name} von {count} Agenten entfernen",
    other: "{name} von allen {count} Agenten entfernen",
  },
  "marketplace.skills.agent.toggle": "{name} für {agent}",
  "marketplace.skills.agent.remove": "Entfernen",
  "marketplace.skills.agent.removeName": "{name} von {agent} entfernen",
  "marketplace.skills.add": "Hinzufügen",
  "marketplace.skills.addName": "{name} zu Agenten hinzufügen",
  "marketplace.skills.addToAgents": "Zu Agenten hinzufügen",
  "marketplace.skills.onOf": "Aktiv bei {have} von {total}",
  "marketplace.skills.chooseAgents": "{name} ist bei {agents}. Agenten wählen",
  "marketplace.skills.dialog.list": "Agenten mit {name}",
  "marketplace.skills.dialog.search": { one: "{count} Agent durchsuchen", other: "{count} Agenten durchsuchen" },
  "marketplace.skills.dialog.all": { one: "{count} Agent", other: "Alle {count} Agenten" },
  "marketplace.skills.dialog.allMatches": { one: "{count} Treffer", other: "Alle {count} Treffer" },
  "marketplace.skills.dialog.checked": "{checked} von {total}",
  "marketplace.skills.dialog.save": "Speichern",
  "marketplace.skills.dialog.saveBoth": "Speichern: {added} hinzufügen, {removed} entfernen",
  "marketplace.skills.dialog.addTo": "Zu {agents} hinzufügen",
  "marketplace.skills.dialog.removeFrom": "Von {agents} entfernen",
  "marketplace.skills.dialog.full": "Fähigkeitenlimit erreicht",
  "marketplace.skills.dialog.unread": "Fähigkeiten nicht gelesen",
  "marketplace.skills.local.gone": "Kein Agent hat diese Fähigkeit mehr.",
  "marketplace.notice.agentAdded": "{name} hinzugefügt.",
  "marketplace.notice.agentUpdated": "{name} aktualisiert.",
  "marketplace.notice.appConnected": "{name} verbunden.",
  "marketplace.notice.appDisconnected": "{name} getrennt.",
  "marketplace.notice.serverRemoved": "{name} entfernt.",
  "marketplace.notice.skillInstalled": {
    one: "{name} bei {count} Agenten installiert.",
    other: "{name} bei {count} Agenten installiert.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} von {count} Agenten entfernt.",
    other: "{name} von {count} Agenten entfernt.",
  },
  "marketplace.error.skillPartial": "{name} wurde bei diesen Agenten nicht geändert: {agents}. {reason}",
  "marketplace.error.openLink": "Der Link konnte nicht geöffnet werden.",
  "marketplace.error.copyLink": "Der Link konnte nicht kopiert werden.",
  "marketplace.error.connectNoServer": "Wähle einen lokalen Server, um diese App zu verbinden.",
  "marketplace.error.installNoServer": "Wähle einen lokalen Server, um ein Plugin zu installieren.",
  "marketplace.error.installNoAgent": "Wähle einen Agenten, um die Fähigkeiten dieses Plugins zu installieren.",
  "marketplace.error.installLocalOnHost":
    "Installiere {name} auf dem Computer, auf dem diese Agenten laufen: Die App führt ihren Server auf diesem Computer aus.",
  "marketplace.error.installOnHost":
    "Installiere {name} auf dem Computer, auf dem diese Agenten laufen: Die App erfordert eine Anmeldung im Browser.",
  "marketplace.error.appInvalid": "{name} kann nicht hinzugefügt werden: {reason}",
  "marketplace.error.uninstallNoServer": "Wähle einen lokalen Server, um ein Plugin zu deinstallieren.",
  "marketplace.error.uninstallPartial": "Teile von {name} konnten nicht entfernt werden. {failures}",
  "marketplace.error.actionFailed": "Die Marketplace-Aktion konnte nicht abgeschlossen werden. Versuche es erneut.",
  "marketplace.thisAgent": "dieser Agent",
} as const satisfies PartialTranslation<typeof source>;
