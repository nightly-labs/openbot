import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Diese Seite konnte nicht geladen werden",
  "sitePage.error.body":
    "Prüfe deine Verbindung und lade die Seite neu. Wenn sie immer noch nicht lädt, kehre zur Startseite zurück.",
  "sitePage.error.reload": "Seite neu laden",
  "sitePage.error.home": "Zur Startseite",
  "sitePage.join.title": "Einem OpenBot-Server beitreten",
  "sitePage.join.description": "Öffne eine private Server-Einladung in OpenBot.",
  "sitePage.join.eyebrow": "Private Einladung",
  "sitePage.join.intro":
    "Öffne diese Einladung in OpenBot. Die App prüft den Server und fragt dich, bevor sie sich verbindet.",
  "sitePage.join.invalid":
    "Dieser Einladungslink ist ungültig oder unvollständig. Bitte den Server-Inhaber um eine neue Einladung.",
  "sitePage.join.open": "OpenBot öffnen",
  "sitePage.join.browser": "Im Browser öffnen",
  "sitePage.join.download": "OpenBot laden",
  "sitePage.join.notOpened":
    "Wenn OpenBot sich nicht geöffnet hat, installiere es mit {download} oder starte OpenBot einmal, damit es Einladungslinks öffnen kann. Du kannst auch {browser} verwenden.",
  "sitePage.join.mobile":
    "Wenn OpenBot installiert ist, tippe auf {open}. Du kannst diesen Link auch in der App unter Server hinzufügen einfügen.",
  "sitePage.join.singleUse":
    "Ein Einmal-Link funktioniert einmal und läuft dann ab. Ein dauerhafter Link funktioniert, bis der Inhaber ihn widerruft. OpenBot zeigt das Ablaufdatum, bevor du beitrittst.",
  "sitePage.join.email": "Wenn die Einladung per E-Mail kam, melde dich mit dieser E-Mail-Adresse bei OpenBot an.",
  "sitePage.join.share":
    "Dieser Link gibt Zugang zu einem Server. Teile ihn nur mit Personen, die du einladen möchtest.",
  "sitePage.connect.title": "Zurück zu OpenBot",
  "sitePage.connect.failedTitle": "Die Verbindung wurde nicht abgeschlossen",
  "sitePage.connect.openApp": "OpenBot öffnen",
  "sitePage.connect.tryAgainApp": "In OpenBot erneut versuchen",
  "sitePage.connect.tryAgainBrowser": "Im Browser erneut versuchen",
  "sitePage.connect.doneInWebClient":
    "Dein OpenBot-Tab schließt die Verbindung mit {name} ab. Du kannst diesen Tab schließen.",
  "sitePage.connect.doneInApp": "OpenBot schließt die Verbindung mit {name} auf deinem Computer ab.",
  "sitePage.connect.failure.cancelled": "Die Verbindung mit {name} wurde abgebrochen. Nichts wurde geändert.",
  "sitePage.connect.failure.expired": "Die Anmeldung bei {name} ist abgelaufen. Starte die Verbindung erneut.",
  "sitePage.connect.failure.exchange": "{name} hat die Verbindung nicht bestätigt. Versuche es erneut.",
  "sitePage.connect.failure.enterprise": "Verbinde einen Slack-Workspace, nicht eine ganze Organisation.",
  "sitePage.connect.failure.takenSlack":
    "Ein anderer OpenBot-Server antwortet bereits in diesem Slack-Workspace. Trenne ihn auf diesem Server und versuche es dann erneut.",
  "sitePage.connect.failure.takenDiscord":
    "Ein anderer OpenBot-Server antwortet bereits auf diesem Discord-Server. Trenne ihn auf diesem Server und versuche es dann erneut.",
  "sitePage.connect.failure.unavailable":
    "OpenBot kann sich gerade nicht mit {name} verbinden. Versuche es später erneut.",
  "sitePage.connect.failure.tabClosed":
    "Der OpenBot-Tab, der die Verbindung mit {name} gestartet hat, hat nicht geantwortet. Öffne OpenBot in deinem Browser und verbinde {name} erneut.",
  "sitePage.connect.failure.failed": "{name} hat die Verbindung nicht abgeschlossen. Versuche es erneut.",
  "sitePage.connect.restartHint": "Öffne in OpenBot {marketplace}, dann {apps}, dann {name}, und wähle {connect}.",
  "sitePage.connect.notOpened":
    "Starte OpenBot und versuche es dann erneut. Wenn OpenBot nicht auf diesem Computer ist, lade es herunter und verbinde {name} in der App.",
  "sitePage.openApp.title": "Nichts geöffnet?",
  "sitePage.openApp.dismiss": "Nicht jetzt",
  "sitePage.billing.pageTitle": "OpenBot-Abrechnung",
  "sitePage.billing.updatedTitle": "Abrechnung aktualisiert",
  "sitePage.billing.updatedBody": "Kehre zu OpenBot zurück. Du kannst diese Seite schließen.",
  "sitePage.billing.cancelledTitle": "Bezahlung abgebrochen",
  "sitePage.billing.cancelledBody": "Es wurde nichts berechnet. Kehre zu OpenBot zurück.",
  "sitePage.report.pageTitle": "Gehostete Website melden — OpenBot",
  "sitePage.report.title": "Gehostete Website melden",
  "sitePage.report.intro":
    "Sende eine Meldung über schädliche oder rechtswidrige Inhalte auf einer openbot.site-Adresse.",
  "sitePage.report.hostnameLabel": "Website-Adresse",
  "sitePage.report.hostnameMissing": "Gib die Website-Adresse ein",
  "sitePage.report.reasonLabel": "Grund",
  "sitePage.report.reason.phishing": "Phishing",
  "sitePage.report.reason.malware": "Schadsoftware",
  "sitePage.report.reason.abuse": "Missbrauch",
  "sitePage.report.reason.copyright": "Urheberrecht",
  "sitePage.report.reason.other": "Sonstiges",
  "sitePage.report.detailsLabel": "Details",
  "sitePage.report.optional": "Optional",
  "sitePage.report.detailsPlaceholder": "Was stimmt mit dieser Website nicht?",
  "sitePage.report.send": "Meldung senden",
  "sitePage.report.sending": "Wird gesendet…",
  "sitePage.report.tooMany": "Zu viele Meldungen. Versuche es später erneut.",
  "sitePage.report.sendFailed": "Die Meldung konnte nicht gesendet werden. Versuche es erneut.",
  "sitePage.report.writeTo": "Du kannst auch an {email} schreiben.",
  "sitePage.report.sentTitle": "Meldung gesendet",
  "sitePage.report.sentBody": "Danke. Wir haben deine Meldung erhalten.",
  "sitePage.report.home": "Zur Startseite",
  "sitePage.pricing.title": "OpenBot-Preise",
  "sitePage.pricing.description":
    "Gehostete Server und eine Lizenz für Teams. OpenBot ist für die private Nutzung auf deinem eigenen Computer kostenlos.",
  "sitePage.pricing.heading": "Preise",
  "sitePage.pricing.enterprise.title": "Enterprise",
  "sitePage.pricing.enterprise.body":
    "Größere Server, mehr als {count} Mitglieder oder alles andere, was du brauchst. Mit Enterprise-Support.",
  "sitePage.pricing.enterprise.contact": "Vertrieb kontaktieren",
} as const satisfies PartialTranslation<typeof source>;
