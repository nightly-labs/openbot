import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Scegli una cartella di sito statico",
  "dialog.chooseSkill": "Scegli una cartella o uno ZIP di skill",
  "dialog.filter.skillPackages": "Pacchetti di skill",
  "dialog.filter.images": "Immagini",
  "dialog.filter.supportedFiles": "File supportati",
  "dialog.filter.attachment": "Allegato",
  "dialog.filter.zipArchive": "Archivio ZIP",
  "dialog.filter.jsonDocument": "Documento JSON",
  "dialog.chooseAgentExport": "Scegli un'esportazione di agente",
  "dialog.filter.agentExports": "Esportazioni di agenti",
  "dialog.saveExportSkill": "Salva la skill di esportazione",
} as const satisfies PartialTranslation<typeof source>;
