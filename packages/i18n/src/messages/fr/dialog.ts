import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "Choisir un dossier de site statique",
  "dialog.chooseAgentFolder": "Choisir un dossier pour {agent}",
  "dialog.chooseAgentExclusion": "Choisir un dossier que {agent} ne doit pas modifier",
  "dialog.chooseSkill": "Choisir un dossier ou un fichier ZIP de compétence",
  "dialog.filter.skillPackages": "Paquets de compétences",
  "dialog.filter.images": "Images",
  "dialog.filter.supportedFiles": "Fichiers pris en charge",
  "dialog.filter.attachment": "Pièce jointe",
  "dialog.filter.zipArchive": "Archive ZIP",
  "dialog.filter.jsonDocument": "Document JSON",
  "dialog.chooseAgentExport": "Choisir une exportation d’agents",
  "dialog.filter.agentExports": "Exportations d’agents",
  "dialog.saveExportSkill": "Enregistrer la compétence d’exportation",
  "dialog.saveTransfer": "Enregistrer le fichier de transfert",
  "dialog.chooseTransfer": "Choisir un fichier de transfert",
  "dialog.filter.transfer": "Fichiers de transfert OpenBot",
  "dialog.chooseExternalLinkApp": "Choisir un navigateur",
  "dialog.filter.applications": "Applications",
} as const satisfies PartialTranslation<typeof source>;
