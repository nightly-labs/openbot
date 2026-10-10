import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot konnte keine Verbindung herstellen. Versuche es erneut.",
  "mobile.link.invite.signInTitle": "Melde dich an, um diesem Server beizutreten",
  "mobile.link.invite.signInDescription":
    "Scanne den QR-Code in OpenBot auf deinem Computer. Danach kannst du die Einladung prüfen.",
  "mobile.link.invite.cancel": "Einladung abbrechen",
  "mobile.link.pairing.title": "Dieses Telefon verbinden",
  "mobile.link.pairing.alreadySignedIn":
    "Du bist bereits angemeldet. Melde dich in den Einstellungen ab, bevor du ein anderes Konto verbindest.",
  "mobile.link.pairing.description":
    "Fahre nur fort, wenn du diesen Link für die Mobilverbindung auf deinem Desktop angefordert hast.",
  "mobile.link.pairing.connect": "Verbinden",
  "mobile.link.plugin.title": "Plugin-Seite öffnen",
  "mobile.link.plugin.description": "Sieh dir dieses Plugin auf der OpenBot-Website an.",
  "mobile.link.plugin.openFailed": "Die Plugin-Seite konnte nicht geöffnet werden.",
  "mobile.link.plugin.view": "Plugin ansehen",
  "mobile.link.unavailable.title": "Link nicht verfügbar",
  "mobile.link.unavailable.description":
    "Dieser Link ist ungültig, nicht mehr verfügbar oder wird auf Mobilgeräten nicht unterstützt.",
  "mobile.link.template.signInTitle": "Melde dich an, um diesen Agenten hinzuzufügen",
  "mobile.link.template.signInDescription":
    "Scanne den QR-Code in OpenBot auf deinem Computer. Danach kannst du den Agenten prüfen, bevor du ihn hinzufügst.",
  "mobile.link.template.loading": "Agent wird geladen…",
  "mobile.link.template.creator": "Von {name}",
  "mobile.link.template.section.instructions": "Anweisungen",
  "mobile.link.template.section.skills": "Fähigkeiten",
  "mobile.link.template.section.noSkills": "Keine Fähigkeiten.",
  "mobile.link.template.section.routines": "Routinen",
  "mobile.link.template.section.noRoutines": "Keine Routinen.",
  "mobile.link.template.skill.local": "Lokale Fähigkeit (nur SKILL.md)",
  "mobile.link.template.skill.marketplace": "Fähigkeit aus dem Marketplace, Version {version}",
  "mobile.link.template.server.title": "Zum Server hinzufügen",
  "mobile.link.template.server.footer":
    "Nur Server, auf denen du Eigentümer oder Administrator bist, werden aufgeführt.",
  "mobile.link.template.server.updateRequired":
    "Aktualisiere OpenBot auf diesem Server, um geteilte Agenten hinzuzufügen.",
  "mobile.link.template.server.none":
    "Du musst Eigentümer oder Administrator eines Servers sein, um einen geteilten Agenten hinzuzufügen.",
  "mobile.link.template.install.action": "Agenten hinzufügen",
  "mobile.link.template.install.pending": "Wird hinzugefügt…",
  "mobile.link.template.install.failed": "Der Agent konnte nicht hinzugefügt werden.",
  "mobile.link.template.notFound.title": "Agent nicht gefunden",
  "mobile.link.template.notFound.description":
    "Dieser geteilte Agent existiert nicht, oder sein Ersteller hat die Veröffentlichung zurückgezogen.",
  "mobile.link.template.error.title": "Der Agent konnte nicht geladen werden",
  "mobile.link.template.error.loadFailed": "Der geteilte Agent konnte nicht gelesen werden. Versuche es erneut.",
  "mobile.link.template.error.unsupported":
    "Dieser Server kann keine geteilten Agenten hinzufügen. Aktualisiere OpenBot auf dem Computer, auf dem der Server läuft.",
} as const satisfies PartialTranslation<typeof source>;
