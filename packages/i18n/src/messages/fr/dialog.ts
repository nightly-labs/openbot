import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "Choisir un dossier de site statique",
  "dialog.chooseSkill": "Choisir un dossier ou un fichier ZIP de compétence",
  "dialog.filter.skillPackages": "Paquets de compétences",
  "dialog.filter.images": "Images",
  "dialog.filter.supportedFiles": "Fichiers pris en charge",
  "dialog.filter.attachment": "Pièce jointe",
  "dialog.filter.zipArchive": "Archive ZIP",
  "dialog.filter.jsonDocument": "Document JSON",
} as const satisfies PartialTranslation<typeof source>;
