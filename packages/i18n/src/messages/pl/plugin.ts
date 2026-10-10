import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Strona internetowa",
  "plugin.link.privacyPolicy": "Polityka prywatności",
  "plugin.link.terms": "Warunki korzystania",
  "plugin.copyLink": "Kopiuj link",
  "plugin.askPrompt": "Zapytaj {name}: {prompt}",
  "plugin.section.apps": "Aplikacje",
  "plugin.section.skills": "Umiejętności",
  "plugin.section.information": "Informacje",
  "plugin.info.developer": "Twórca",
  "plugin.info.category": "Kategoria",
  "plugin.info.version": "Wersja",
  "plugin.uninstallDialog.title": "Odłączyć {name}?",
  "plugin.uninstallDialog.description":
    "Elementy zainstalowane przez {name} na tym komputerze zostaną usunięte. Nic innego na tym hoście ani w tym agencie się nie zmieni.",
  "plugin.uninstallDialog.confirm": "Odłącz",
  "plugin.uninstallDialog.appsLabel": "Aplikacje do usunięcia: {number}",
  "plugin.uninstallDialog.appsTitle": "Aplikacje usunięte z tego hosta",
  "plugin.uninstallDialog.appsNote":
    "Ich narzędzia przestają być dostępne, a dane logowania zapisane dla nich przez OpenBot zostają zapomniane.",
  "plugin.uninstallDialog.skillsLabel": "Umiejętności do usunięcia: {number}",
  "plugin.uninstallDialog.skillsTitle": "Umiejętności usunięte z agenta {agentName}",
} as const satisfies PartialTranslation<typeof source>;
