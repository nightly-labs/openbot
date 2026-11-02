import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Kies een map met een statische site",
  "dialog.chooseAgentFolder": "Kies een map voor {agent}",
  "dialog.chooseAgentExclusion": "Kies een map die {agent} niet mag wijzigen",
  "dialog.chooseSkill": "Kies een vaardigheidsmap of ZIP",
  "dialog.filter.skillPackages": "Vaardigheidspakketten",
  "dialog.filter.images": "Afbeeldingen",
  "dialog.filter.supportedFiles": "Ondersteunde bestanden",
  "dialog.filter.attachment": "Bijlage",
  "dialog.filter.zipArchive": "ZIP-archief",
  "dialog.filter.jsonDocument": "JSON-document",
  "dialog.chooseAgentExport": "Kies een agentexport",
  "dialog.chooseHermesFolder": "Kies de Hermes-map",
  "dialog.filter.agentExports": "Agentexports",
  "dialog.chooseVaultCsv": "Kies een wachtwoordexport",
  "dialog.filter.csv": "CSV-bestanden",
  "dialog.saveExportSkill": "Exportvaardigheid opslaan",
  "dialog.saveTransfer": "Overdrachtsbestand opslaan",
  "dialog.chooseTransfer": "Kies een overdrachtsbestand",
  "dialog.filter.transfer": "OpenBot-overdrachtsbestanden",
  "dialog.chooseExternalLinkApp": "Kies een browser",
  "dialog.filter.applications": "Apps",
} as const satisfies PartialTranslation<typeof source>;
