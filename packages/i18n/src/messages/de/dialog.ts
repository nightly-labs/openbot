import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Verzeichnis für eine statische Website auswählen",
  "dialog.chooseAgentFolder": "Ordner für {agent} auswählen",
  "dialog.chooseAgentExclusion": "Ordner auswählen, den {agent} nicht ändern darf",
  "dialog.chooseSkill": "Fähigkeitsordner oder ZIP auswählen",
  "dialog.filter.skillPackages": "Fähigkeitspakete",
  "dialog.filter.images": "Bilder",
  "dialog.filter.supportedFiles": "Unterstützte Dateien",
  "dialog.filter.attachment": "Anhang",
  "dialog.filter.zipArchive": "ZIP-Archiv",
  "dialog.filter.jsonDocument": "JSON-Dokument",
  "dialog.chooseAgentExport": "Agentenexport auswählen",
  "dialog.filter.agentExports": "Agentenexporte",
  "dialog.saveExportSkill": "Exportfähigkeit speichern",
  "dialog.saveTransfer": "Übertragungsdatei speichern",
  "dialog.chooseTransfer": "Übertragungsdatei wählen",
  "dialog.filter.transfer": "OpenBot-Übertragungsdateien",
  "dialog.chooseExternalLinkApp": "Browser auswählen",
  "dialog.filter.applications": "Programme",
} as const satisfies PartialTranslation<typeof source>;
