import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Scegli una cartella di sito statico",
  "dialog.chooseAgentFolder": "Scegli una cartella per {agent}",
  "dialog.chooseAgentExclusion": "Scegli una cartella che {agent} non deve modificare",
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
  "dialog.saveTransfer": "Salva il file di trasferimento",
  "dialog.chooseTransfer": "Scegli un file di trasferimento",
  "dialog.filter.transfer": "File di trasferimento OpenBot",
  "dialog.chooseExternalLinkApp": "Scegli un browser",
  "dialog.filter.applications": "Applicazioni",
} as const satisfies PartialTranslation<typeof source>;
