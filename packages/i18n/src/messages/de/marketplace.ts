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
  "marketplace.close": "Marketplace schließen",
  "marketplace.kinds": "Inhaltstypen im Marketplace",
  "marketplace.tab.agents": "Agenten",
  "marketplace.tab.skills": "Fähigkeiten",
  "marketplace.plugins.missing": "Dieses Plugin ist nicht im OpenBot-Katalog.",
  "marketplace.agents.loadingDetail": "Agentendetails werden geladen…",
  "marketplace.agents.skills": "Fähigkeiten",
  "marketplace.agents.routines": "Routinen",
  "marketplace.agents.routineActive": "Aktiv",
  "marketplace.agents.routineInactive": "Inaktiv",
  "marketplace.skill.loading": "Fähigkeit wird geladen",
  "marketplace.skill.update": "Fähigkeit aktualisieren",
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
  "marketplace.filter.installed": "Installiert",
  "marketplace.filter.notInstalled": "Nicht installiert",
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
  "marketplace.properties.skill": "Über diese Fähigkeit",
  "marketplace.properties.creator": "Ersteller",
  "marketplace.properties.category": "Kategorie",
  "marketplace.properties.version": "Version",
  "marketplace.properties.updated": "Aktualisiert",
  "marketplace.properties.installs": "Installationen",
  "marketplace.agent.add": "Hinzufügen",
  "marketplace.agent.addNamed": "{name} hinzufügen",
  "marketplace.agent.addAgent": "Agent hinzufügen",
  "marketplace.agent.added": "Hinzugefügt",
  "marketplace.agent.updateAvailable": "Aktualisierung verfügbar",
  "marketplace.agent.update": "Aktualisieren",
  "marketplace.agent.openChat": "Chat öffnen",
  "marketplace.app.connect": "Verbinden",
  "marketplace.app.reconnect": "Erneut verbinden",
  "marketplace.app.connectNamed": "{name} verbinden",
  "marketplace.app.reconnectNamed": "{name} erneut verbinden",
  "marketplace.app.connected": "Verbunden",
  "marketplace.app.attention": "Erfordert Aufmerksamkeit",
  "marketplace.app.notConnected": "Nicht verbunden",
  "marketplace.app.custom": "MCP-Server",
  "marketplace.app.githubTagline": "Repositorys, Issues und Pull Requests",
  "marketplace.app.onePasswordTagline": "Bei Websites mit von dir geteilten Zugangsdaten anmelden",
  "marketplace.app.onePasswordCategory": "Verwaltung von Anmeldungen und Zugangsdaten",
  "marketplace.app.yourApps": "Deine Apps",
  "marketplace.app.moreApps": "Weitere Apps",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Befehl",
  "marketplace.app.address": "Adresse",
  "marketplace.app.disconnect.title": "Trennen",
  "marketplace.app.disconnect.description":
    "Entferne {name} und die zugehörigen Fähigkeiten von diesem Computer. Du kannst die App später erneut verbinden.",
  "marketplace.app.disconnect.action": "Trennen",
  "marketplace.app.remove.title": "Server entfernen",
  "marketplace.app.remove.description":
    "Deine Agenten können diesen Server nicht mehr nutzen. Seine Einstellungen werden gelöscht.",
  "marketplace.app.remove.action": "Entfernen",
  "marketplace.app.remove.confirmTitle": "{name} entfernen?",
  "marketplace.app.remove.keep": "Behalten",
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
  "marketplace.plugin.sentry.tagline": "Fehler- und Absturz-Triage",
  "marketplace.plugin.sentry.description":
    "Mit Sentry durchsuchen Agenten aktuelle Fehler, prüfen Stacktraces und betroffene Releases und fassen zusammen, was nach einem Deployment kaputtgegangen ist. Jeder Nutzer meldet sich im Browser bei seinem eigenen Sentry-Konto an.",
  "marketplace.plugin.sentry.app":
    "Fehlersuche, Issue-Prüfung und Release-Zustand über den MCP-Server von Sentry mit Anmeldung im Browser.",
  "marketplace.plugin.sentry.prompt.newErrors": "Welche neuen Fehler sind seit dem gestrigen Deployment aufgetreten?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Erkläre den häufigsten Absturz im Mobile-Projekt und seine wahrscheinliche Ursache.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Wie stabil ist das aktuelle Release im Vergleich zum letzten?",
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
    "Composio verbindet Agenten über einen MCP-Server mit Gmail, Slack, GitHub und Hunderten weiterer Apps. Erstelle den Server in deinem Composio-Konto, füge ihm die gewünschten Apps hinzu und füge seinen Link hier ein. Füge einen API-Schlüssel nur hinzu, wenn dein Server einen verlangt.",
  "marketplace.plugin.composio.app":
    "Die Apps, die du deinem Composio-MCP-Server hinzufügst, über den Link aus deinem Composio-Konto.",
  "marketplace.plugin.composio.prompt.inbox":
    "Fasse meine ungelesenen E-Mails zusammen und entwirf Antworten auf die dringenden.",
  "marketplace.plugin.composio.prompt.handoff": "Poste eine Zusammenfassung dieses Pull Requests in unseren Teamkanal.",
  "marketplace.plugin.composio.prompt.apps": "Welche Apps und Aktionen kannst du über Composio nutzen?",
  "marketplace.skill.installMenu.install": "Installieren",
  "marketplace.skill.installMenu.installNamed": "{name} installieren",
  "marketplace.skill.installMenu.allAgents": "Alle Agenten",
  "marketplace.skill.installMenu.agents": {
    one: "{count} Agent",
    other: "{count} Agenten",
  },
  "marketplace.skill.installMenu.here": "Du bist hier",
  "marketplace.skill.installMenu.change": {
    one: "{label} hat {name}. Ändern",
    other: "{label} haben {name}. Ändern",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "In {name} ausprobieren",
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
