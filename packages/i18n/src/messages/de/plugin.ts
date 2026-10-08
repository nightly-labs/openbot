import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Website",
  "plugin.link.privacyPolicy": "Datenschutzerklärung",
  "plugin.link.terms": "Nutzungsbedingungen",
  "plugin.copyLink": "Link kopieren",
  "plugin.askPrompt": "Frage {name}: {prompt}",
  "plugin.section.apps": "Apps",
  "plugin.section.skills": "Fähigkeiten",
  "plugin.section.information": "Informationen",
  "plugin.info.developer": "Entwickler",
  "plugin.info.category": "Kategorie",
  "plugin.info.version": "Version",
  "plugin.uninstallDialog.title": "Verbindung zu {name} trennen?",
  "plugin.uninstallDialog.description":
    "Dies entfernt, was {name} auf diesem Computer installiert hat. Sonst ändert sich nichts an diesem Host oder Agenten.",
  "plugin.uninstallDialog.confirm": "Verbindung trennen",
  "plugin.uninstallDialog.appsLabel": "Zu entfernende Apps: {number}",
  "plugin.uninstallDialog.appsTitle": "Von diesem Host entfernte Apps",
  "plugin.uninstallDialog.appsNote":
    "Ihre Werkzeuge sind nicht mehr verfügbar. Von OpenBot gespeicherte Anmeldedaten für diese Apps werden entfernt.",
  "plugin.uninstallDialog.skillsLabel": "Zu entfernende Fähigkeiten: {number}",
  "plugin.uninstallDialog.skillsTitle": "Aus {agentName} entfernte Fähigkeiten",
} as const satisfies PartialTranslation<typeof source>;
