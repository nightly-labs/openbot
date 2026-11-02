import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Website",
  "plugin.link.privacyPolicy": "Privacybeleid",
  "plugin.link.terms": "Servicevoorwaarden",
  "plugin.copyLink": "Link kopiëren",
  "plugin.askPrompt": "Vraag {name}: {prompt}",
  "plugin.section.skills": "Vaardigheden",
  "plugin.section.information": "Informatie",
  "plugin.info.developer": "Ontwikkelaar",
  "plugin.info.category": "Categorie",
  "plugin.info.version": "Versie",
  "plugin.uninstallDialog.title": "Verbinding met {name} verbreken?",
  "plugin.uninstallDialog.description":
    "Hiermee verwijder je wat {name} op deze computer heeft geïnstalleerd. Verder verandert er niets op deze host of aan deze agent.",
  "plugin.uninstallDialog.confirm": "Verbreken",
  "plugin.uninstallDialog.appsLabel": "Te verwijderen apps, {number}",
  "plugin.uninstallDialog.appsTitle": "Apps die van deze host worden verwijderd",
  "plugin.uninstallDialog.appsNote":
    "Hun tools zijn dan niet meer beschikbaar en eventuele inloggegevens die OpenBot voor ze bewaarde, worden vergeten.",
  "plugin.uninstallDialog.skillsLabel": "Te verwijderen vaardigheden, {number}",
  "plugin.uninstallDialog.skillsTitle": "Vaardigheden die van {agentName} worden verwijderd",
} as const satisfies PartialTranslation<typeof source>;
