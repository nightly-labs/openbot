import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Sito web",
  "plugin.link.privacyPolicy": "Informativa sulla privacy",
  "plugin.link.terms": "Termini di servizio",
  "plugin.copyLink": "Copia link",
  "plugin.askPrompt": "Chiedi a {name}: {prompt}",
  "plugin.section.apps": "App",
  "plugin.section.skills": "Skill",
  "plugin.section.information": "Informazioni",
  "plugin.info.developer": "Sviluppatore",
  "plugin.info.category": "Categoria",
  "plugin.info.version": "Versione",

  "plugin.uninstallDialog.title": "Disconnettere {name}?",
  "plugin.uninstallDialog.description":
    "Verrà rimosso ciò che {name} ha installato su questo computer. Nient'altro su questo host o su questo agente cambia.",
  "plugin.uninstallDialog.confirm": "Disconnetti",
  "plugin.uninstallDialog.appsLabel": "App da rimuovere, {number}",
  "plugin.uninstallDialog.appsTitle": "App rimosse da questo host",
  "plugin.uninstallDialog.appsNote":
    "I loro strumenti non saranno più disponibili e ogni accesso che OpenBot ha conservato per loro verrà dimenticato.",
  "plugin.uninstallDialog.skillsLabel": "Skill da rimuovere, {number}",
  "plugin.uninstallDialog.skillsTitle": "Skill rimosse da {agentName}",
} as const satisfies PartialTranslation<typeof source>;
