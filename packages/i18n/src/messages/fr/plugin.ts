import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Site web",
  "plugin.link.privacyPolicy": "Politique de confidentialité",
  "plugin.link.terms": "Conditions d’utilisation",
  "plugin.copyLink": "Copier le lien",
  "plugin.install": "Installer le plugin",
  "plugin.uninstall": "Désinstaller le plugin",
  "plugin.askPrompt": "Demander à {name} : {prompt}",
  "plugin.section.apps": "Apps",
  "plugin.section.skills": "Compétences",
  "plugin.section.information": "Informations",
  "plugin.info.developer": "Développeur",
  "plugin.info.category": "Catégorie",
  "plugin.info.version": "Version",

  "plugin.uninstallDialog.title": "Désinstaller {name} ?",
  "plugin.uninstallDialog.description":
    "Cette action supprime ce que {name} a installé sur cet ordinateur. Rien d’autre ne change sur cet hôte ni sur cet agent.",
  "plugin.uninstallDialog.confirm": "Désinstaller",
  "plugin.uninstallDialog.appsLabel": "Apps à supprimer : {number}",
  "plugin.uninstallDialog.appsTitle": "Apps supprimées de cet hôte",
  "plugin.uninstallDialog.appsNote":
    "Leurs outils ne sont plus disponibles, et OpenBot oublie les connexions qu’il gardait pour elles.",
  "plugin.uninstallDialog.skillsLabel": "Compétences à supprimer : {number}",
  "plugin.uninstallDialog.skillsTitle": "Compétences supprimées de {agentName}",
} as const satisfies PartialTranslation<typeof source>;
